# Runtime Compatibility Fixtures

These fixtures lock behavior that releases must preserve while the build and
release system changes. They cover rendered comments, IAM expansion, grouping,
truncation, no-op results, input failures, and review-comment synchronization.

Update an expected result only when the related behavior or locked IAM dataset
is intentionally changing. Review the fixture change alongside the production
change that requires it.
