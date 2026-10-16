# Publish only after owner confirmation

The repository is initialized with a reviewed staged source snapshot, zero commits, no remote and no tags. No original repository history was imported. The working directory must be this source-only release directory. Review the staged changes and your Git author identity before creating the first commit.

The commands below perform public actions. They are instructions only and were not executed during preparation. Replace `YOUR_GITHUB_USER` with the intended owner. Use a **new empty repository** so unrelated history is not mixed in.

```powershell
git diff --cached --stat
git commit -m "Release matched Chat/Coding experimental source preview"
gh repo create YOUR_GITHUB_USER/dsh-chat-mode-preview --public --source . --remote origin
git push -u origin main
git tag v0.1.0-preview.1
git push origin v0.1.0-preview.1
gh release create v0.1.0-preview.1 --prerelease --title "Chat/Coding Experimental Preview" --notes-file RELEASE-NOTES.md
```

Do not upload the build-validation directory, private logs or original M1 folder. GitHub's generated source archive should contain only this commit. If any source is edited after review, repeat the relevant validation and secret scan before publishing. The existing repository Gate failures must remain disclosed in the release notes.
