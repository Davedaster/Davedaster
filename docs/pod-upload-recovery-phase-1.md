# POD upload recovery phase 1

This branch is reserved for the poor signal POD upload recovery fix.

Scope for the code change:

- Keep the existing POD rules intact.
- Keep proof photo and signature requirements intact.
- Keep safe place requirements intact.
- Keep customer notification sending unchanged.
- Catch failed driver POD form parsing/upload failures so they return a driver friendly retry message instead of an application error.

No runtime code is changed by this document.
