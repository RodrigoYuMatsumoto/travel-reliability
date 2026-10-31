// Synthetic compiled adapter only; no mailbox, credential, network or tool-selected module.
import { loadOperatorProfile } from '../../agent/operator-profile.js';
import { TravelConnectorRegistry } from '../../agent/connectors.js';
import { startTravelStdio } from '../../agent/mcp.js';

const options = await loadOperatorProfile(process.argv[2]!, {});
options.connectors = new TravelConnectorRegistry(
  [
    {
      id: 'synthetic',
      documentationUrl: 'https://example.invalid/synthetic-connector',
      async read({ recordKeys }) {
        return recordKeys.map((recordKey, index) => ({
          recordKey,
          sourceRef: 'SRC' + String(index + 30),
          referenceToken: null,
          startDate: null,
          endDate: null,
          status: 'unknown',
          currency: null,
          totalMinor: null,
          policyHash: null,
          observedAt: new Date().toISOString(),
          expiresAt: null,
          origin: 'user_export',
        }));
      },
    },
  ],
  {
    approvedScopes: [{ tripKey: 'demo-1', sourceId: 'synthetic', recordKeys: ['R01'] }],
    maxReads: 2,
  },
);
startTravelStdio(options);
