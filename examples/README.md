# Synthetic fixtures

Every file in this directory is generated synthetic data, dedicated under
CC0-1.0. Reserved example hosts are placeholders, not suppliers or live offers.
Amounts and booking references are invented. No real travel or identity records
are included.

`npm run contracts:generate` regenerates the fixtures and public API/schema
artifacts. Run a deterministic workflow with:

```sh
npm run plan -- total-cost examples/total-cost.json
npm run plan -- group-split examples/group-split.json
```

CC0 legal code: https://creativecommons.org/publicdomain/zero/1.0/legalcode.en
The application source and schemas remain Apache-2.0.
