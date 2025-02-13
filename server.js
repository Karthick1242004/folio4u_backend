const express = require("express");
const cors = require("cors");
const axios = require("axios");
const app = express();
const bodyParser = require("body-parser");
const whois = require('whois');
const mongoose = require('mongoose');

require("dotenv").config();

app.use(cors({
    origin: "*", // Allow all origins
    methods: ["GET", "POST", "PUT", "DELETE"], // Allow these methods
    allowedHeaders: ["Content-Type", "Authorization"], // Allow these headers
}));


app.use(bodyParser.json());
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_FILENAME = process.env.GIST_FILENAME;
const REPO_OWNER = process.env.REPO_OWNER;
const BASE_REPO_NAME = process.env.BASE_REPO_NAME;
const NETLIFY_ACCESS_TOKEN = process.env.NETLIFY_ACCESS_TOKEN;
const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID;
const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github.v3+json",
};

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Create MongoDB Schema
const hostedSiteSchema = new mongoose.Schema({
    userId: String,
    userEmail: String,
    userName: String,
    hostedSites: [{
        siteName: String,
        subdomain: String,
        gistUrl: String,
        createdAt: { type: Date, default: Date.now }
    }]
});

const HostedSite = mongoose.model('hosted', hostedSiteSchema);

// Create MongoDB Schema for Likes
const likeSchema = new mongoose.Schema({
    siteName: String,
    likeCount: { type: Number, default: 0 },
    likedBy: [String]  // Array of userIds who liked the site
});

const Like = mongoose.model('like', likeSchema);

// API to create a new Gist
app.post("/create-gist", async (req, res) => {
    const { content } = req.body;

    try {
        const response = await axios.post(
            "https://api.github.com/gists",
            {
                files: {
                    "data.json": {
                        content,
                    },
                },
                public: true,
            },
            {
                headers: {
                    Authorization: `token ${GITHUB_TOKEN}`,
                },
            }
        );

        const gistId = response.data.id;
        const gistRawUrl = `https://gist.githubusercontent.com/${REPO_OWNER}/${gistId}/raw/data.json`;

        res.status(201).json({ gistId, gistRawUrl });
    } catch (error) {
        console.error("GitHub API error:", error.response?.data || error.message);
        res.status(500).json({ message: "Failed to create gist", error: error.message });
    }
});

// API to update Gist URL in the repository
let storedSubdomain = ""; // Global variable for the subdomain

app.post("/update-gist-url", async (req, res) => {
    const { gistRawUrl, subdomain, repoName } = req.body;

    console.log("Received Gist URL:", gistRawUrl);
    console.log("Received Subdomain:", subdomain);
    console.log("Received Repository Name:", repoName);

    if (!gistRawUrl || !subdomain || !repoName) {
        return res.status(400).json({ 
            message: "Gist URL, subdomain, and repository name are required" 
        });
    }

    try {
        // Update the Gist URL in the GitHub repository
        const filePath = "src/hooks/usePortfolioData.ts";
        const { data: fileData } = await axios.get(
            `https://api.github.com/repos/${REPO_OWNER}/${repoName}/contents/${filePath}`,
            {
                headers: {
                    Authorization: `token ${GITHUB_TOKEN}`,
                },
            }
        );

        const originalContent = Buffer.from(fileData.content, "base64").toString("utf-8");
        const updatedContent = originalContent.replace(
            /const DATA_URL = '.*?';/,
            `const DATA_URL = '${gistRawUrl}';`
        );
        const encodedContent = Buffer.from(updatedContent).toString("base64");

        await axios.put(
            `https://api.github.com/repos/${REPO_OWNER}/${repoName}/contents/${filePath}`,
            {
                message: "Updated Gist URL in usePortfolioData.ts",
                content: encodedContent,
                sha: fileData.sha,
            },
            {
                headers: {
                    Authorization: `token ${GITHUB_TOKEN}`,
                },
            }
        );

        // Update the stored subdomain
        storedSubdomain = subdomain;

        res.status(200).json({ message: "Gist URL and subdomain updated successfully" });
    } catch (error) {
        console.error("GitHub API error:", error.response?.data || error.message);
        res.status(500).json({ message: "Failed to update gist URL in repository", error: error.message });
    }
});


let latestDeployedUrl = ""; // Variable to store the deployed URL

// // API to capture the latest deployed URL
// app.post("/capture-deployed-url", (req, res) => {
//   const { deployedUrl } = req.body;

//   if (!deployedUrl) {
//     return res.status(400).json({ message: "Deployed URL is required" });
//   }
//   latestDeployedUrl = deployedUrl;
//   res.status(200).json({ message: "Deployed URL captured successfully" });
// });
// API to get the latest deployed URL
// app.get("/get-deployed-url", (req, res) => {
//   if (!latestDeployedUrl) {
//     return res.status(404).json({ message: "No deployed URL available" });
//   }
//   res.status(200).json({ deployedUrl: latestDeployedUrl });
// });

app.get('/check-domain/:subdomain', async (req, res) => {
    const { subdomain } = req.params;
    const domain = `https://${subdomain}.netlify.app`;
  
    try {
      const response = await axios.get(domain);
      res.status(200).json({ available: false }); // If the request succeeds, domain is not available
    } catch (error) {
      if (error.response && error.response.status === 404) {
        res.status(200).json({ available: true }); // If 404, domain is available
      } else {
        res.status(500).json({ error: 'Error checking domain availability' });
      }
    }
  });

app.get("/get-subdomain", (req, res) => {
  if (!storedSubdomain) {
      return res.status(404).json({ message: "No subdomain stored" });
  }

  res.status(200).json({ subdomain: storedSubdomain });
});

// New API to store hosted site information
app.post("/store-hosted-site", async (req, res) => {
    const { userId, userEmail, userName, subdomain, gistUrl, siteName } = req.body;

    if (!userId || !userEmail || !subdomain || !gistUrl || !siteName) {
        return res.status(400).json({ 
            message: "User ID, email, subdomain, site name, and gist URL are required" 
        });
    }

    try {
        let userRecord = await HostedSite.findOne({ userId: userId });

        if (!userRecord) {
            userRecord = new HostedSite({
                userId,
                userEmail,
                userName,
                hostedSites: []
            });
        }

        // Add new hosted site to user's array with siteName
        userRecord.hostedSites.push({
            siteName,
            subdomain,
            gistUrl
        });

        await userRecord.save();

        res.status(200).json({ 
            message: "Hosted site information stored successfully",
            data: userRecord
        });
    } catch (error) {
        console.error("MongoDB error:", error);
        res.status(500).json({ 
            message: "Failed to store hosted site information", 
            error: error.message 
        });
    }
});

// API to get user's hosted sites
app.get("/get-user-sites/:userId", async (req, res) => {
    try {
        const userRecord = await HostedSite.findOne({ userId: req.params.userId });
        
        if (!userRecord) {
            return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json({ 
            sites: userRecord.hostedSites,
            userData: {
                email: userRecord.userEmail,
                name: userRecord.userName
            }
        });
    } catch (error) {
        console.error("MongoDB error:", error);
        res.status(500).json({ 
            message: "Failed to fetch user's hosted sites", 
            error: error.message 
        });
    }
});

// API to handle like/unlike
app.post("/toggle-like", async (req, res) => {
    const { siteName, userId } = req.body;

    if (!siteName || !userId) {
        return res.status(400).json({ 
            message: "Site name and user ID are required" 
        });
    }

    try {
        // Normalize the site name to prevent duplicates
        const normalizedSiteName = siteName.trim();
        
        let likeRecord = await Like.findOne({ siteName: normalizedSiteName });

        // If no record exists for this site, create one
        if (!likeRecord) {
            likeRecord = new Like({
                siteName: normalizedSiteName,
                likeCount: 0,
                likedBy: []
            });
        }

        // Check if user already liked the site
        const userLikedIndex = likeRecord.likedBy.indexOf(userId);
        
        if (userLikedIndex === -1) {
            // User hasn't liked the site yet - add like
            likeRecord.likedBy.push(userId);
            likeRecord.likeCount += 1;
        } else {
            // User already liked - remove like
            likeRecord.likedBy.splice(userLikedIndex, 1);
            likeRecord.likeCount -= 1;
        }

        await likeRecord.save();

        res.status(200).json({ 
            message: "Like updated successfully",
            likeCount: likeRecord.likeCount,
            isLiked: userLikedIndex === -1  // Returns true if this was a like action, false if unlike
        });
    } catch (error) {
        console.error("MongoDB error:", error);
        res.status(500).json({ 
            message: "Failed to update like", 
            error: error.message 
        });
    }
});

// API to get like count and status for a site
app.get("/get-likes/:siteName", async (req, res) => {
    try {
        const siteName = decodeURIComponent(req.params.siteName).trim();
        const { userId } = req.query;

        const likeRecord = await Like.findOne({ siteName: siteName });
        
        if (!likeRecord) {
            return res.status(200).json({ 
                likeCount: 0, 
                isLiked: false 
            });
        }

        res.status(200).json({ 
            likeCount: likeRecord.likeCount,
            isLiked: userId ? likeRecord.likedBy.includes(userId) : false
        });
    } catch (error) {
        console.error("MongoDB error:", error);
        res.status(500).json({ 
            message: "Failed to fetch like count", 
            error: error.message 
        });
    }
});

const PORT = 5001;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});




// https://folio4ubackend-production.up.railway.app/update-gist-url