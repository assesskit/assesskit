---
"@assesskit/custom-interactions": major
---

`readModuleFiles(name, { signal })` takes no `directory`, and `ReadModuleFilesOptions` is gone: the files are keyed under `modules/`, the folder of the guides, and a tool that keeps the modules elsewhere renames the keys of the `Map`.
