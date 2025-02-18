import {
  EthereumAddress,
  formatSeconds,
  ProjectId,
  UnixTime,
} from '@l2beat/shared-pure'

import {
  addSentimentToDataAvailability,
  CONTRACTS,
  EXITS,
  FORCE_TRANSACTIONS,
  makeBridgeCompatible,
  MILESTONES,
  NUGGETS,
  OPERATOR,
  RISK_VIEW,
  TECHNOLOGY_DATA_AVAILABILITY,
} from '../common'
import { subtractOne } from '../common/assessCount'
import { UPGRADE_MECHANISM } from '../common/upgradeMechanism'
import { ProjectDiscovery } from '../discovery/ProjectDiscovery'
import { Layer2 } from './types'

const discovery = new ProjectDiscovery('nova')
const assumedBlockTime = 12 // seconds, different from RollupUserLogic.sol#L35 which assumes 13.2 seconds
const validatorAfkBlocks = discovery.getContractValue<number>(
  'RollupProxy',
  'VALIDATOR_AFK_BLOCKS',
)
const validatorAfkTime = validatorAfkBlocks * assumedBlockTime
const challengeWindow = discovery.getContractValue<number>(
  'RollupProxy',
  'confirmPeriodBlocks',
)
const challengeWindowSeconds = challengeWindow * assumedBlockTime
const l1TimelockDelay = discovery.getContractValue<number>(
  'L1ArbitrumTimelock',
  'getMinDelay',
)
const l2TimelockDelay = 259200 // 3 days, got from https://arbiscan.io/address/0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0#readProxyContract

const maxTimeVariation = discovery.getContractValue<number[]>(
  'SequencerInbox',
  'maxTimeVariation',
)
const selfSequencingDelay = maxTimeVariation[2]

const nOfChallengers = discovery.getContractValue<string[]>(
  'RollupProxy',
  'validators',
).length

const DAC = discovery.getContractValue<{
  membersCount: number
  requiredSignatures: number
}>('SequencerInbox', 'dacKeyset')
const { membersCount, requiredSignatures } = DAC

export const nova: Layer2 = {
  type: 'layer2',
  id: ProjectId('nova'),
  display: {
    name: 'Arbitrum Nova',
    slug: 'nova',
    description:
      'Arbitrum Nova is an AnyTrust Optimium, differing from Arbitrum One by not posting transaction data onchain.',
    purposes: ['Universal'],
    category: 'Optimium',
    provider: 'Arbitrum',
    links: {
      websites: [
        'https://nova.arbitrum.io/',
        'https://arbitrum.io/',
        'https://arbitrum.foundation/',
      ],
      apps: [],
      documentation: [
        'https://developer.arbitrum.io/',
        'https://developer.arbitrum.io/inside-arbitrum-nitro/#inside-anytrust',
      ],
      explorers: [
        'https://nova.arbiscan.io/',
        'https://nova-explorer.arbitrum.io/',
      ],
      repositories: [
        'https://github.com/ArbitrumFoundation/docs',
        'https://github.com/ArbitrumFoundation/governance',
        'https://github.com/OffchainLabs/nitro',
      ],
      socialMedia: [
        'https://twitter.com/arbitrum',
        'https://arbitrumfoundation.medium.com/',
        'https://discord.gg/Arbitrum',
      ],
    },
    activityDataSource: 'Blockchain RPC',
  },
  stage: {
    stage: 'NotApplicable',
  },
  config: {
    escrows: [
      {
        address: EthereumAddress('0xC1Ebd02f738644983b6C4B2d440b8e77DdE276Bd'),
        sinceTimestamp: new UnixTime(1656073623),
        tokens: ['ETH'],
      },
      {
        address: EthereumAddress('0xA2e996f0cb33575FA0E36e8f62fCd4a9b897aAd3'),
        sinceTimestamp: new UnixTime(1659620187),
        tokens: ['DAI'],
      },
      {
        address: EthereumAddress('0xB2535b988dcE19f9D71dfB22dB6da744aCac21bf'),
        sinceTimestamp: new UnixTime(1656305583),
        tokens: '*',
      },
    ],
    transactionApi: {
      type: 'rpc',
      defaultUrl: 'https://nova.arbitrum.io/rpc',
      assessCount: subtractOne,
      startBlock: 1,
    },
  },
  dataAvailability: addSentimentToDataAvailability({
    layers: ['DAC', 'Ethereum (calldata)'],
    bridge: {
      type: 'DAC Members',
      membersCount,
      requiredSignatures,
    },
    mode: 'Transactions data (compressed)',
  }),
  riskView: makeBridgeCompatible({
    stateValidation: RISK_VIEW.STATE_ARBITRUM_FRAUD_PROOFS(nOfChallengers),
    dataAvailability: RISK_VIEW.DATA_EXTERNAL_DAC({
      membersCount,
      requiredSignatures,
    }),
    exitWindow: {
      ...RISK_VIEW.EXIT_WINDOW(l2TimelockDelay, selfSequencingDelay, 0),
      sentiment: 'bad',
      description: `Upgrades are initiated on L2 and have to go first through a ${formatSeconds(
        l2TimelockDelay,
      )} delay. Since there is a ${formatSeconds(
        selfSequencingDelay,
      )} to force a tx, users have only ${formatSeconds(
        l2TimelockDelay - selfSequencingDelay,
      )} to exit.\nIf users post a tx after that time, they would need to self propose a root with a ${formatSeconds(
        validatorAfkTime,
      )} delay and then wait for the ${formatSeconds(
        challengeWindowSeconds,
      )} challenge window, while the upgrade would be confirmed just after the ${formatSeconds(
        challengeWindowSeconds,
      )} challenge window and the ${formatSeconds(
        l1TimelockDelay,
      )} L1 timelock.`,
      warning: {
        value: 'The Security Council can upgrade with no delay.',
        sentiment: 'bad',
      },
    },
    sequencerFailure: RISK_VIEW.SEQUENCER_SELF_SEQUENCE(selfSequencingDelay),
    proposerFailure: RISK_VIEW.PROPOSER_SELF_PROPOSE_WHITELIST_DROPPED(
      validatorAfkBlocks * assumedBlockTime,
    ),
    destinationToken: RISK_VIEW.NATIVE_AND_CANONICAL(),
    validatedBy: RISK_VIEW.VALIDATED_BY_ETHEREUM,
  }),
  technology: {
    stateCorrectness: {
      name: 'Fraud proofs ensure state correctness',
      description:
        'After some period of time, the published state root is assumed to be correct. For a certain time period, usually one week one of the whitelisted actors can submit a fraud proof that shows that the state was incorrect.',
      risks: [
        {
          category: 'Funds can be stolen if',
          text: 'none of the whitelisted verifiers checks the published state. Fraud proofs assume at least one honest and able validator.',
          isCritical: true,
        },
      ],
      references: [
        {
          text: 'How is fraud proven - Arbitrum documentation FAQ',
          href: 'https://developer.offchainlabs.com/intro/#q-and-how-exactly-is-fraud-proven-sounds-complicated',
        },
        {
          text: 'RollupUserLogic.sol#L288 - Etherscan source code, onlyValidator modifier',
          href: 'https://etherscan.io/address/0xA0Ed0562629D45B88A34a342f20dEb58c46C15ff#code#F1#L288',
        },
      ],
    },
    dataAvailability: TECHNOLOGY_DATA_AVAILABILITY.ANYTRUST_OFF_CHAIN({
      membersCount,
      requiredSignatures,
    }),
    operator: {
      ...OPERATOR.CENTRALIZED_SEQUENCER,
      references: [
        {
          text: 'Sequencer - Arbitrum documentation',
          href: 'https://developer.offchainlabs.com/sequencer',
        },
      ],
    },
    forceTransactions: {
      ...FORCE_TRANSACTIONS.CANONICAL_ORDERING,
      references: [
        {
          text: 'Sequencer Isn’t Doing Its Job - Arbitrum documentation',
          href: 'https://developer.offchainlabs.com/sequencer#unhappyuncommon-case-sequencer-isnt-doing-its-job',
        },
      ],
    },
    exitMechanisms: [
      {
        ...EXITS.REGULAR('optimistic', 'merkle proof'),
        references: [
          {
            text: 'Transaction lifecycle - Arbitrum documentation',
            href: 'https://developer.offchainlabs.com/tx-lifecycle',
          },
          {
            text: 'L2 to L1 Messages - Arbitrum documentation',
            href: 'https://developer.offchainlabs.com/arbos/l2-to-l1-messaging',
          },
          {
            text: 'Mainnet for everyone - Arbitrum Blog',
            href: 'https://offchain.medium.com/mainnet-for-everyone-27ce0f67c85e',
          },
        ],
        risks: [],
      },
      {
        name: 'Tradeable Bridge Exit',
        description:
          "When a user initiates a regular withdrawal a third party verifying the chain can offer to buy this withdrawal by paying the user on L1. The user will get the funds immediately, however the third party has to wait for the block to be finalized. This is implemented as a first party functionality inside Arbitrum's token bridge.",
        risks: [],
        references: [
          {
            text: 'Tradeable Bridge Exits - Arbitrum documentation',
            href: 'https://developer.offchainlabs.com/docs/withdrawals#tradeable-bridge-exits',
          },
        ],
      },
    ],
    otherConsiderations: [
      {
        name: 'EVM compatible smart contracts are supported',
        description:
          'Arbitrum Nova uses Nitro technology that allows running fraud proofs by executing EVM code on top of WASM.',
        risks: [
          {
            category: 'Funds can be lost if',
            text: 'there are mistakes in the highly complex Nitro and WASM one-step prover implementation.',
          },
        ],
        references: [
          {
            text: 'Arbitrum Nitro Sneak Preview',
            href: 'https://medium.com/offchainlabs/arbitrum-nitro-sneak-preview-44550d9054f5',
          },
        ],
      },
      UPGRADE_MECHANISM.ARBITRUM_DAO(
        l1TimelockDelay,
        challengeWindow * assumedBlockTime,
        l2TimelockDelay,
      ),
    ],
  },
  contracts: {
    addresses: [
      discovery.getContractDetails(
        'ProxyAdmin 1',
        'This contract is an admin of most other contracts allowed to upgrade their implementations. It is owned by the Upgrade Executor.',
      ),
      discovery.getContractDetails(
        'UpgradeExecutor',
        "This contract can upgrade the system's contracts. The upgrades can be done either by the Security Council or by the L1ArbitrumTimelock. Can cancel Timelock's proposals.",
      ),
      discovery.getContractDetails(
        'ProxyAdmin 2',
        'This contract is an admin of the Update Executor contract, but is also owned by it.',
      ),
      discovery.getContractDetails(
        'L1ArbitrumTimelock',
        'Timelock contract for Arbitrum DAO Governance. It gives the DAO participants the ability to upgrade the system. Only the Nova counterpart of this contract can execute the upgrades.',
      ),
      discovery.getContractDetails(
        'RollupProxy',
        'Main contract implementing Arbitrum Nova Rollup. Manages other Rollup components, list of Stakers and Validators. Entry point for Validators creating new Rollup Nodes (state commits) and Challengers submitting fraud proofs.',
      ),
      discovery.getContractDetails(
        'SequencerInbox',
        'Main entry point for the Sequencer submitting transaction batches to a Rollup.',
      ),
      discovery.getContractDetails(
        'Inbox',
        'Entry point for users depositing ETH and sending L1 --> Nova messages. Deposited ETH is escrowed in a Bridge contract.',
      ),
      discovery.getContractDetails(
        'Bridge',
        'Contract managing Inboxes and Outboxes. It escrows ETH sent to Nova.',
      ),
      discovery.getContractDetails('Outbox'),
      discovery.getContractDetails(
        'ChallengeManager',
        'Contract managing an interactive fraud challenge process.',
      ),
      discovery.getContractDetails(
        'OneStepProofEntry',
        'Contract managing adjudication logic for EVM implementation in WASM used by the fraud proofs.',
      ),
      discovery.getContractDetails(
        'ProxyAdmin 3',
        'Yet another proxy admin for the three gateway contracts below. It is also owned by the Upgrade Executor.',
      ),
      discovery.getContractDetails(
        'L1GatewayRouter',
        'Router managing token <--> gateway mapping.',
      ),
      discovery.getContractDetails(
        'L1ERC20Gateway',
        'Main entry point for users depositing ERC20 tokens. Upon depositing, on Nova a generic, "wrapped" token will be minted.',
      ),
      discovery.getContractDetails(
        'L1CustomGateway',
        'Main entry point for users depositing ERC20 tokens that require minting custom token on Nova.',
      ),
      discovery.getContractDetails(
        'L1DaiGateway',
        'Custom DAI Gateway, main entry point for users depositing DAI to Nova where "canonical" Nova DAI token managed by MakerDAO will be minted. Managed by MakerDAO.',
      ),
      discovery.getContractDetails(
        'L1Escrow',
        'DAI Vault for custom DAI Gateway managed by MakerDAO.',
      ),
    ],
    risks: [CONTRACTS.UPGRADE_NO_DELAY_RISK],
  },
  milestones: [
    {
      ...MILESTONES.MAINNET_OPEN,
      date: '2022-08-09T00:00:00Z',
      link: 'https://medium.com/offchainlabs/its-time-for-a-new-dawn-nova-is-open-to-the-public-a081df1e4ad2',
    },
  ],
  knowledgeNuggets: [
    {
      title: 'Data availability on Arbitrum Nova',
      url: 'https://twitter.com/bkiepuszewski/status/1555180043525128200',
      thumbnail: NUGGETS.THUMBNAILS.L2BEAT_03,
    },
  ],
}
