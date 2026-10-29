# Project workflow

- After completing and verifying requested changes, commit the task's changes and push the current branch to its configured GitHub upstream without asking again. Report the commit and push result.
- Keep secrets such as `.env` and generated Netlify deployment packages out of Git.
- When changing the dashboard, regenerate `netlify-deploy` and `netlify-deploy.zip` with `배포폴더_만들기.ps1` and `Compress-Archive` before committing. These generated artifacts remain ignored.
