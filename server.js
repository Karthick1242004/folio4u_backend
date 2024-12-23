const express = require("express");
const cors = require("cors");
const axios = require("axios");
const app = express();
const bodyParser = require("body-parser");
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
app.post("/update-gist-url", async (req, res) => {
    const { gistRawUrl } = req.body;

    console.log("Received Gist URL:", gistRawUrl); // Debug log

    if (!gistRawUrl) {
        return res.status(400).json({ message: "Gist URL is required" });
    }

    try {
        const filePath = "src/hooks/usePortfolioData.ts";
        const { data: fileData } = await axios.get(
            `https://api.github.com/repos/${REPO_OWNER}/${BASE_REPO_NAME}/contents/${filePath}`,
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
            `https://api.github.com/repos/${REPO_OWNER}/${BASE_REPO_NAME}/contents/${filePath}`,
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

        res.status(200).json({ message: "Gist URL updated in repository" });
    } catch (error) {
        console.error("GitHub API error:", error.response?.data || error.message);
        res.status(500).json({ message: "Failed to update gist URL in repository", error: error.message });
    }
});

let latestDeployedUrl = ""; // Variable to store the deployed URL

// API to capture the latest deployed URL
app.post("/capture-deployed-url", (req, res) => {
  const { deployedUrl } = req.body;

  if (!deployedUrl) {
    return res.status(400).json({ message: "Deployed URL is required" });
  }

  latestDeployedUrl = deployedUrl;
  res.status(200).json({ message: "Deployed URL captured successfully" });
});

// API to get the latest deployed URL
app.get("/get-deployed-url", (req, res) => {
  if (!latestDeployedUrl) {
    return res.status(404).json({ message: "No deployed URL available" });
  }

  res.status(200).json({ deployedUrl: latestDeployedUrl });
});

// Start the server
const PORT = 5001;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
