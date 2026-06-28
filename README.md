# ADG-Lang

ADG-Lang is a type-safe Arabic grammar language project.

The public repository is reserved for the explicit project name and public-facing materials. Active native-proof development is maintained in the private development repository:

```text
sbay-dev/ADG-Lang-dev
```

## Native Proof Summary

```text
Valid ADG AST
  => VerifiedAdgProgram
  => LLVM IR
  => Native Executable

Invalid ADG AST
  => ADG Diagnostic
  => No LLVM IR
  => No Native Executable
```
