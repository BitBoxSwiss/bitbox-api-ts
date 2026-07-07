// SPDX-License-Identifier: Apache-2.0

import { FormEvent, useState } from 'react';
import * as bitbox from '@bitboxswiss/bitbox-api';

import { ErrorNotification } from './ErrorNotification';
import { ResultBlock, bytesToHex, hexToBytes } from './form-utils';

type Props = { bb02: bitbox.PairedBitBox };

const DEFAULT_XPUB_KEYPATHS = `m/1852'/1815'/0'
m/1852'/1815'/1'`;

const DEFAULT_SIGN_TX = `{
  "network": "mainnet",
  "inputs": [
    {
      "keypath": "m/1852'/1815'/0'/0/0",
      "prevOutHash": "59864ee73ca5d91098a32b3ce9811bac1996dcbaefa6b6247dcaafb5779c2538",
      "prevOutIndex": 0
    }
  ],
  "outputs": [
    {
      "encodedAddress": "addr1q9qfllpxg2vu4lq6rnpel4pvpp5xnv3kvvgtxk6k6wp4ff89xrhu8jnu3p33vnctc9eklee5dtykzyag5penc6dcmakqsqqgpt",
      "value": "1000000",
      "assetGroups": [
        {
          "policyId": "1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209",
          "tokens": [
            { "assetName": "504154415445", "value": "1" },
            { "assetName": "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373", "value": "3" }
          ]
        }
      ]
    },
    {
      "encodedAddress": "$CHANGE_ADDRESS",
      "value": "4829501",
      "scriptConfig": {
        "pkhSkh": {
          "keypathPayment": "m/1852'/1815'/0'/1/0",
          "keypathStake": "m/1852'/1815'/0'/2/0"
        }
      }
    }
  ],
  "fee": "170499",
  "ttl": "41115811",
  "certificates": [],
  "withdrawals": [],
  "validityIntervalStart": "41110811",
  "allowZeroTTL": false,
  "tagCborSets": false
}`;

type JsonScriptConfig = {
  pkhSkh: {
    keypathPayment: bitbox.Keypath;
    keypathStake: bitbox.Keypath;
  };
};

type JsonInput = {
  keypath: bitbox.Keypath;
  prevOutHash: string;
  prevOutIndex: number;
};

type JsonToken = {
  assetName: string;
  value: string | number;
};

type JsonAssetGroup = {
  policyId: string;
  tokens: JsonToken[];
};

type JsonOutput = {
  encodedAddress: string;
  value: string | number;
  scriptConfig?: JsonScriptConfig;
  assetGroups?: JsonAssetGroup[];
};

type JsonCertificate =
  | { stakeRegistration: { keypath: bitbox.Keypath } }
  | { stakeDeregistration: { keypath: bitbox.Keypath } }
  | { stakeDelegation: { keypath: bitbox.Keypath; poolKeyhash: string } }
  | {
      voteDelegation: {
        keypath: bitbox.Keypath;
        type: bitbox.CardanoDrepType;
        drepCredhash?: string;
      };
    };

type JsonWithdrawal = {
  keypath: bitbox.Keypath;
  value: string | number;
};

type JsonTransaction = {
  network: bitbox.CardanoNetwork;
  inputs: JsonInput[];
  outputs: JsonOutput[];
  fee: string | number;
  ttl: string | number;
  certificates: JsonCertificate[];
  withdrawals: JsonWithdrawal[];
  validityIntervalStart: string | number;
  allowZeroTTL: boolean;
  tagCborSets: boolean;
};

function pkhSkh(
  keypathPayment: bitbox.Keypath,
  keypathStake: bitbox.Keypath,
): bitbox.CardanoScriptConfig {
  return {
    pkhSkh: {
      keypathPayment,
      keypathStake,
    },
  };
}

function parseUint64(value: string | number): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`invalid uint64 value: ${value}`);
    }
    return BigInt(value);
  }
  if (value.trim() === '') {
    throw new Error('empty uint64 value');
  }
  return BigInt(value);
}

function parseScriptConfig(scriptConfig: JsonScriptConfig): bitbox.CardanoScriptConfig {
  return {
    pkhSkh: {
      keypathPayment: scriptConfig.pkhSkh.keypathPayment,
      keypathStake: scriptConfig.pkhSkh.keypathStake,
    },
  };
}

function parseCertificate(certificate: JsonCertificate): bitbox.CardanoCertificate {
  if ('stakeRegistration' in certificate) {
    return {
      stakeRegistration: {
        keypath: certificate.stakeRegistration.keypath,
      },
    };
  }
  if ('stakeDeregistration' in certificate) {
    return {
      stakeDeregistration: {
        keypath: certificate.stakeDeregistration.keypath,
      },
    };
  }
  if ('stakeDelegation' in certificate) {
    return {
      stakeDelegation: {
        keypath: certificate.stakeDelegation.keypath,
        poolKeyhash: hexToBytes(certificate.stakeDelegation.poolKeyhash),
      },
    };
  }
  const { voteDelegation } = certificate;
  return {
    voteDelegation: {
      keypath: voteDelegation.keypath,
      type: voteDelegation.type,
      ...(voteDelegation.drepCredhash === undefined || voteDelegation.drepCredhash === ''
        ? {}
        : { drepCredhash: hexToBytes(voteDelegation.drepCredhash) }),
    },
  };
}

async function parseOutput(
  bb02: bitbox.PairedBitBox,
  network: bitbox.CardanoNetwork,
  output: JsonOutput,
): Promise<bitbox.CardanoOutput> {
  const scriptConfig = output.scriptConfig === undefined
    ? undefined
    : parseScriptConfig(output.scriptConfig);
  let encodedAddress = output.encodedAddress;
  if (encodedAddress === '$CHANGE_ADDRESS') {
    if (scriptConfig === undefined) {
      throw new Error('$CHANGE_ADDRESS output requires scriptConfig');
    }
    encodedAddress = await bb02.cardanoAddress(network, scriptConfig, false);
  }
  return {
    encodedAddress,
    value: parseUint64(output.value),
    ...(scriptConfig === undefined ? {} : { scriptConfig }),
    ...(output.assetGroups === undefined
      ? {}
      : {
          assetGroups: output.assetGroups.map(assetGroup => ({
            policyId: hexToBytes(assetGroup.policyId),
            tokens: assetGroup.tokens.map(token => ({
              assetName: hexToBytes(token.assetName),
              value: parseUint64(token.value),
            })),
          })),
        }),
  };
}

async function parseTransaction(
  bb02: bitbox.PairedBitBox,
  raw: string,
): Promise<bitbox.CardanoTransaction> {
  const parsed = JSON.parse(raw) as JsonTransaction;
  return {
    network: parsed.network,
    inputs: parsed.inputs.map(input => ({
      keypath: input.keypath,
      prevOutHash: hexToBytes(input.prevOutHash),
      prevOutIndex: input.prevOutIndex,
    })),
    outputs: await Promise.all(parsed.outputs.map(output => (
      parseOutput(bb02, parsed.network, output)
    ))),
    fee: parseUint64(parsed.fee),
    ttl: parseUint64(parsed.ttl),
    certificates: parsed.certificates.map(parseCertificate),
    withdrawals: parsed.withdrawals.map(withdrawal => ({
      keypath: withdrawal.keypath,
      value: parseUint64(withdrawal.value),
    })),
    validityIntervalStart: parseUint64(parsed.validityIntervalStart),
    allowZeroTTL: parsed.allowZeroTTL,
    tagCborSets: parsed.tagCborSets,
  };
}

function formatXpubs(xpubs: bitbox.CardanoXpubs): string {
  return xpubs.map(bytesToHex).join('\n');
}

function formatSignResult(result: bitbox.CardanoSignTransactionResult | undefined): string {
  if (result === undefined) {
    return '';
  }
  return JSON.stringify({
    shelleyWitnesses: result.shelleyWitnesses.map(witness => ({
      publicKey: bytesToHex(witness.publicKey),
      signature: bytesToHex(witness.signature),
    })),
  }, null, 2);
}

function CardanoXpubs({ bb02 }: Props) {
  const [keypaths, setKeypaths] = useState(DEFAULT_XPUB_KEYPATHS);
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setResult('');
    setErr(undefined);
    try {
      const parsedKeypaths = keypaths.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      setResult(formatXpubs(await bb02.cardanoXpubs(parsedKeypaths)));
    } catch (e2) {
      setErr(bitbox.ensureError(e2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>XPubs</h4>
      <form className="verticalForm" onSubmit={submitForm}>
        <label>Keypaths</label>
        <textarea value={keypaths} onChange={e => setKeypaths(e.target.value)} rows={3} />
        <button type="submit" disabled={running}>Get XPubs</button>
        <ResultBlock value={result} />
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </div>
  );
}

function CardanoAddress({ bb02 }: Props) {
  const [network, setNetwork] = useState<bitbox.CardanoNetwork>('mainnet');
  const [keypathPayment, setKeypathPayment] = useState("m/1852'/1815'/0'/0/0");
  const [keypathStake, setKeypathStake] = useState("m/1852'/1815'/0'/2/0");
  const [display, setDisplay] = useState(true);
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setResult('');
    setErr(undefined);
    try {
      setResult(await bb02.cardanoAddress(
        network,
        pkhSkh(keypathPayment, keypathStake),
        display,
      ));
    } catch (e2) {
      setErr(bitbox.ensureError(e2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Address</h4>
      <form className="verticalForm" onSubmit={submitForm}>
        <label>
          Network
          <select
            value={network}
            onChange={e => setNetwork(e.target.value as bitbox.CardanoNetwork)}
          >
            <option value="mainnet">mainnet</option>
            <option value="testnet">testnet</option>
          </select>
        </label>
        <label>
          Payment keypath
          <input type="text" value={keypathPayment} onChange={e => setKeypathPayment(e.target.value)} />
        </label>
        <label>
          Stake keypath
          <input type="text" value={keypathStake} onChange={e => setKeypathStake(e.target.value)} />
        </label>
        <label>
          Display on device
          <input type="checkbox" checked={display} onChange={e => setDisplay(e.target.checked)} />
        </label>
        <button type="submit" disabled={running}>Get address</button>
        {result !== '' && (
          <div className="resultContainer">
            <label>
              Result: <b><code>{result}</code></b>
            </label>
          </div>
        )}
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </div>
  );
}

function CardanoSignTransaction({ bb02 }: Props) {
  const [txJson, setTxJson] = useState(DEFAULT_SIGN_TX);
  const [result, setResult] = useState<bitbox.CardanoSignTransactionResult>();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setResult(undefined);
    setErr(undefined);
    try {
      setResult(await bb02.cardanoSignTransaction(await parseTransaction(bb02, txJson)));
    } catch (e2) {
      setErr(bitbox.ensureError(e2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Sign Transaction</h4>
      <form className="verticalForm" onSubmit={submitForm}>
        <label>Transaction</label>
        <textarea value={txJson} onChange={e => setTxJson(e.target.value)} rows={30} />
        <button type="submit" disabled={running}>Sign transaction</button>
        <ResultBlock value={formatSignResult(result)} />
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </div>
  );
}

export function Cardano({ bb02 }: Props) {
  return (
    <>
      <div className="action"><CardanoXpubs bb02={bb02} /></div>
      <div className="action"><CardanoAddress bb02={bb02} /></div>
      <div className="action"><CardanoSignTransaction bb02={bb02} /></div>
    </>
  );
}
