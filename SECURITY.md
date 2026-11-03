# Security policy

The project is pre-1.0. No independent penetration test or security certification
is claimed. Treat production deployment as an operator responsibility requiring
the controls in [operations](docs/OPERATIONS.md).

Report a suspected vulnerability using the repository's **Security → Report a
vulnerability** private channel when enabled. If it is unavailable, open a minimal
issue asking for a private reporting channel; do not include payloads, documents,
credentials, personal data or details enabling compromise. No response-time SLA
is promised until maintainers establish one.

Supported target: the latest published, non-prerelease version. The 0.6.x line
supersedes 0.5.x when its stable release is published; a candidate or an unpublished
tag does not change the supported version. Earlier releases receive no guaranteed
backports. Consult [GitHub Releases](https://github.com/RodrigoYuMatsumoto/travel-reliability/releases/latest)
for the current supported target. Test only installations you own or are authorized to assess. Use
synthetic records and describe affected version, preconditions, impact and a
minimal reproduction.

The application's trust boundaries, known limits, dependency management and
incident procedure are documented in [security model](docs/SECURITY_MODEL.md).
Executed security regression coverage and evaluations not completed are listed
in [security verification scope](docs/SECURITY_TESTS.md).
