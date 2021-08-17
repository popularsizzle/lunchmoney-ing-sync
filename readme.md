Lunch Money ING Sync
===

This app will check your ING (Australia) bank accounts for new transactions every hour, and sync
them to your Lunch Money account usig the API.

Initial Setup
---

- Make sure you have Node and Serverless installed, and AWS credentials configured. Full
  instructions are available on the
  [Serverless AWS](https://www.serverless.com/framework/docs/providers/aws/guide/installation/)
  docs.
- Add ING login details, a Lunch Money API key, and a map of ING to Lunch Money accounts in
  `serverless.yml`.

Running Locally
---

```
npm install
sls invoke local -f sync
```

Deploying to AWS
---

```
sls deploy
```
