import { EthereumAddress, ProjectId, UnixTime } from '@l2beat/shared-pure'
import { expect } from 'earl'
import { readFileSync } from 'fs'

import {
  BigQueryFunctionCallResult,
  TrackedTxFunctionCallResult,
} from '../types/model'
import { TrackedTxId } from '../types/TrackedTxId'
import {
  TrackedTxFunctionCallConfig,
  TrackedTxSharpSubmissionConfig,
} from '../types/TrackedTxsConfig'
import { transformFunctionCallsQueryResult } from './transformFunctionCallsQueryResult'

const ADDRESS_1 = EthereumAddress.random()
const SELECTOR_1 = '0x095e4'
const ADDRESS_2 = EthereumAddress.random()
const SELECTOR_2 = '0x915d9'
const SINCE_TIMESTAMP = UnixTime.now()

const timestamp = UnixTime.fromDate(new Date('2022-01-01T01:00:00Z'))
const block = 1
const txHashes = [
  '0x095e4e9ee709e353ad7849cf30e4dc19',
  '0x915d9ed63e196d8c612aad5d6f5cd1ba',
  '0x90d5e81b40d6a6fa6f34b3dc67d3fce6',
]

const inputFile = `src/test/sharpVerifierInput.txt`
const sharpInput = readFileSync(inputFile, 'utf-8')
const paradexProgramHash =
  '3258367057337572248818716706664617507069572185152472699066582725377748079373'

describe(transformFunctionCallsQueryResult.name, () => {
  it('should transform results', () => {
    const functionCalls: TrackedTxFunctionCallConfig[] = [
      {
        formula: 'functionCall',
        projectId: ProjectId('project1'),
        address: ADDRESS_1,
        selector: SELECTOR_1,
        sinceTimestampInclusive: SINCE_TIMESTAMP,
        uses: [
          {
            type: 'liveness',
            subtype: 'batchSubmissions',
            id: TrackedTxId.random(),
          },
        ],
      },
      {
        formula: 'functionCall',
        projectId: ProjectId('project1'),
        address: ADDRESS_2,
        selector: SELECTOR_2,
        sinceTimestampInclusive: SINCE_TIMESTAMP,
        uses: [
          {
            type: 'liveness',
            subtype: 'stateUpdates',
            id: TrackedTxId.random(),
          },
        ],
      },
    ]

    const sharpSubmissions: TrackedTxSharpSubmissionConfig[] = [
      {
        formula: 'sharpSubmission',
        projectId: ProjectId('project2'),
        sinceTimestampInclusive: SINCE_TIMESTAMP,
        programHashes: [paradexProgramHash],
        address: EthereumAddress.random(),
        selector: '0x9b3b76cc',
        uses: [
          {
            type: 'liveness',
            subtype: 'proofSubmissions',
            id: TrackedTxId.random(),
          },
        ],
      },
    ]

    const queryResults: BigQueryFunctionCallResult[] = [
      {
        hash: txHashes[0],
        block_number: block,
        block_timestamp: timestamp,
        input: SELECTOR_1,
        to_address: ADDRESS_1,
      },
      {
        hash: txHashes[1],
        block_number: block,
        block_timestamp: timestamp,
        input: SELECTOR_2,
        to_address: ADDRESS_2,
      },
      {
        hash: txHashes[2],
        block_number: block,
        block_timestamp: timestamp,
        input: sharpInput,
        to_address: sharpSubmissions[0].address,
      },
    ]
    const expected: TrackedTxFunctionCallResult[] = [
      {
        type: 'functionCall',
        projectId: functionCalls[0].projectId,
        use: functionCalls[0].uses[0],
        hash: txHashes[0],
        blockNumber: block,
        blockTimestamp: timestamp,
        toAddress: ADDRESS_1,
        input: SELECTOR_1,
      },
      {
        type: 'functionCall',
        projectId: functionCalls[1].projectId,
        use: functionCalls[1].uses[0],
        hash: txHashes[1],
        blockNumber: block,
        blockTimestamp: timestamp,
        toAddress: ADDRESS_2,
        input: SELECTOR_2,
      },
      {
        type: 'functionCall',
        projectId: sharpSubmissions[0].projectId,
        use: sharpSubmissions[0].uses[0],
        hash: txHashes[2],
        blockNumber: block,
        blockTimestamp: timestamp,
        toAddress: sharpSubmissions[0].address,
        input: sharpInput,
      },
    ]
    const result = transformFunctionCallsQueryResult(
      functionCalls,
      sharpSubmissions,
      queryResults,
    )

    expect(result).toEqual(expected)
  })

  it('throws when there is no matching configuration', () => {
    const functionCalls: TrackedTxFunctionCallConfig[] = [
      {
        formula: 'functionCall',
        projectId: ProjectId('project1'),
        address: ADDRESS_1,
        selector: SELECTOR_1,
        sinceTimestampInclusive: SINCE_TIMESTAMP,
        uses: [],
      },
    ]

    const queryResults: BigQueryFunctionCallResult[] = [
      {
        hash: txHashes[0],
        to_address: EthereumAddress.random(),
        input: 'random-string',
        block_number: block,
        block_timestamp: timestamp,
      },
    ]

    expect(() =>
      transformFunctionCallsQueryResult(functionCalls, [], queryResults),
    ).toThrow('There should be at least one matching config')
  })

  it('includes only configurations which program hashes were proven', () => {
    const sharpSubmissions: TrackedTxSharpSubmissionConfig[] = [
      {
        formula: 'sharpSubmission',
        projectId: ProjectId('project1'),
        sinceTimestampInclusive: SINCE_TIMESTAMP,
        programHashes: [paradexProgramHash],
        address: EthereumAddress.random(),
        selector: '0x9b3b76cc',
        uses: [
          {
            type: 'liveness',
            subtype: 'proofSubmissions',
            id: TrackedTxId.random(),
          },
        ],
      },
      {
        formula: 'sharpSubmission',
        projectId: ProjectId('project2'),
        sinceTimestampInclusive: SINCE_TIMESTAMP,
        programHashes: [paradexProgramHash + 'wrong-rest-part-of-hash'],
        address: EthereumAddress.random(),
        selector: 'random-selector-2',
        uses: [],
      },
    ]

    const queryResults: BigQueryFunctionCallResult[] = [
      {
        hash: txHashes[0],
        to_address: sharpSubmissions[0].address,
        input: sharpInput,
        block_number: block,
        block_timestamp: timestamp,
      },
    ]

    const expected: TrackedTxFunctionCallResult[] = [
      {
        type: 'functionCall',
        projectId: sharpSubmissions[0].projectId,
        use: sharpSubmissions[0].uses[0],
        hash: txHashes[0],
        blockNumber: block,
        blockTimestamp: timestamp,
        toAddress: sharpSubmissions[0].address,
        input: sharpInput,
      },
    ]

    const result = transformFunctionCallsQueryResult(
      [],
      sharpSubmissions,
      queryResults,
    )

    expect(result).toEqual(expected)
  })
})
