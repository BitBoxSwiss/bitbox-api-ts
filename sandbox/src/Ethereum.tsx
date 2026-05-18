// SPDX-License-Identifier: Apache-2.0

import { FormEvent, useState } from 'react';
import * as bitbox from '@bitboxswiss/bitbox-api';

import { ErrorNotification } from './ErrorNotification';

type Props = { bb02: bitbox.PairedBitBox };

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (body.length % 2 !== 0) {
    throw new Error(`invalid hex length: ${hex}`);
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`invalid hex digit in ${hex}`);
    }
    out[i] = byte;
  }
  return out;
}

function stringToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function ResultBlock({ value }: { value: string }) {
  if (value === '') {
    return null;
  }
  return (
    <div className="resultContainer">
      <label>Result</label>
      <textarea rows={Math.min(value.split('\n').length + 2, 32)} readOnly defaultValue={value} />
    </div>
  );
}

function formatResult(value: unknown | undefined): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}

function EthXPub({ bb02 }: Props) {
  const keypaths = ["m/44'/60'/0'/0", "m/44'/1'/0'/0"];
  const [keypath, setKeypath] = useState(keypaths[0]);
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setResult('');
    setErr(undefined);
    try {
      setResult(await bb02.ethXpub(keypath));
    } catch (e2) {
      setErr(bitbox.ensureError(e2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>XPub</h4>
      <form className="verticalForm" onSubmit={submitForm}>
        <label>
          Keypath
          <select value={keypath} onChange={e => setKeypath(e.target.value)}>
            {keypaths.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={running}>Get XPub</button>
        <ResultBlock value={result} />
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </div>
  );
}

function EthAddress({ bb02 }: Props) {
  const [chainID, setChainID] = useState(1);
  const [keypath, setKeypath] = useState("m/44'/60'/0'/0/0");
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
      setResult(await bb02.ethAddress(BigInt(chainID), keypath, display));
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
          Chain ID
          <input
            type="number"
            value={chainID}
            onChange={e => setChainID(Number.parseInt(e.target.value, 10))}
          />
        </label>
        <label>
          Keypath
          <input type="text" value={keypath} onChange={e => setKeypath(e.target.value)} />
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

function EthSignTransaction({ bb02 }: Props) {
  const defaultTx = `{
  "nonce": "1fdc",
  "gasPrice": "0165a0bc00",
  "gasLimit": "5208",
  "recipient": "04f264cf34440313b4a0192a352814fbe927b885",
  "value": "075cf1259e9c4000",
  "data": ""
}`;
  const [chainID, setChainID] = useState(1);
  const [keypath, setKeypath] = useState("m/44'/60'/0'/0/0");
  const [txJson, setTxJson] = useState(defaultTx);
  const [result, setResult] = useState<bitbox.EthSignature | undefined>();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setResult(undefined);
    setErr(undefined);
    try {
      const parsed = JSON.parse(txJson);
      const tx: bitbox.EthTransaction = {
        nonce: hexToBytes(parsed.nonce),
        gasPrice: hexToBytes(parsed.gasPrice),
        gasLimit: hexToBytes(parsed.gasLimit),
        recipient: hexToBytes(parsed.recipient),
        value: hexToBytes(parsed.value),
        data: hexToBytes(parsed.data),
      };
      const addressCase = bitbox.ethIdentifyCase(parsed.recipient);
      setResult(await bb02.ethSignTransaction(BigInt(chainID), keypath, tx, addressCase));
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
        <label>
          Chain ID
          <input
            type="number"
            value={chainID}
            onChange={e => setChainID(Number.parseInt(e.target.value, 10))}
          />
        </label>
        <label>
          Keypath
          <input type="text" value={keypath} onChange={e => setKeypath(e.target.value)} />
        </label>
        <label>Transaction</label>
        <textarea value={txJson} onChange={e => setTxJson(e.target.value)} rows={9} />
        <button type="submit" disabled={running}>Sign transaction</button>
        <ResultBlock value={formatResult(result)} />
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </div>
  );
}

function EthSign1559Transaction({ bb02 }: Props) {
  const defaultTx = `{
  "nonce": "1fdc",
  "maxPriorityFeePerGas": "3b9aca00",
  "maxFeePerGas": "04a817c800",
  "gasLimit": "5208",
  "recipient": "04f264cf34440313b4a0192a352814fbe927b885",
  "value": "075cf1259e9c4000",
  "data": ""
}`;
  const [chainID, setChainID] = useState(1);
  const [keypath, setKeypath] = useState("m/44'/60'/0'/0/0");
  const [txJson, setTxJson] = useState(defaultTx);
  const [result, setResult] = useState<bitbox.EthSignature | undefined>();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setResult(undefined);
    setErr(undefined);
    try {
      const parsed = JSON.parse(txJson);
      const tx: bitbox.Eth1559Transaction = {
        chainId: chainID,
        nonce: hexToBytes(parsed.nonce),
        maxPriorityFeePerGas: hexToBytes(parsed.maxPriorityFeePerGas),
        maxFeePerGas: hexToBytes(parsed.maxFeePerGas),
        gasLimit: hexToBytes(parsed.gasLimit),
        recipient: hexToBytes(parsed.recipient),
        value: hexToBytes(parsed.value),
        data: hexToBytes(parsed.data),
      };
      const addressCase = bitbox.ethIdentifyCase(parsed.recipient);
      setResult(await bb02.ethSign1559Transaction(keypath, tx, addressCase));
    } catch (e2) {
      setErr(bitbox.ensureError(e2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Sign EIP-1559 Transaction</h4>
      <form className="verticalForm" onSubmit={submitForm}>
        <label>
          Chain ID
          <input
            type="number"
            value={chainID}
            onChange={e => setChainID(Number.parseInt(e.target.value, 10))}
          />
        </label>
        <label>
          Keypath
          <input type="text" value={keypath} onChange={e => setKeypath(e.target.value)} />
        </label>
        <label>Transaction</label>
        <textarea value={txJson} onChange={e => setTxJson(e.target.value)} rows={9} />
        <button type="submit" disabled={running}>Sign EIP-1559 transaction</button>
        <ResultBlock value={formatResult(result)} />
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </div>
  );
}

function EthSignMessage({ bb02 }: Props) {
  const [chainID, setChainID] = useState(1);
  const [keypath, setKeypath] = useState("m/44'/60'/0'/0/0");
  const [msg, setMsg] = useState('hello bitbox');
  const [result, setResult] = useState<bitbox.EthSignature | undefined>();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setResult(undefined);
    setErr(undefined);
    try {
      setResult(await bb02.ethSignMessage(BigInt(chainID), keypath, stringToBytes(msg)));
    } catch (e2) {
      setErr(bitbox.ensureError(e2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Sign Message</h4>
      <form className="verticalForm" onSubmit={submitForm}>
        <label>
          Chain ID
          <input
            type="number"
            value={chainID}
            onChange={e => setChainID(Number.parseInt(e.target.value, 10))}
          />
        </label>
        <label>
          Keypath
          <input type="text" value={keypath} onChange={e => setKeypath(e.target.value)} />
        </label>
        <label>Message</label>
        <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={4} />
        <button type="submit" disabled={running}>Sign message</button>
        <ResultBlock value={formatResult(result)} />
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </div>
  );
}

const EXAMPLE_TYPED_MSG = `{
  "types": {
    "EIP712Domain": [
      { "name": "name", "type": "string" },
      { "name": "version", "type": "string" },
      { "name": "chainId", "type": "uint256" },
      { "name": "verifyingContract", "type": "address" }
    ],
    "Attachment": [{ "name": "contents", "type": "string" }],
    "Person": [
      { "name": "name", "type": "string" },
      { "name": "wallet", "type": "address" },
      { "name": "age", "type": "uint8" }
    ],
    "Mail": [
      { "name": "from", "type": "Person" },
      { "name": "to", "type": "Person" },
      { "name": "contents", "type": "string" },
      { "name": "attachments", "type": "Attachment[]" }
    ]
  },
  "primaryType": "Mail",
  "domain": {
    "name": "Ether Mail",
    "version": "1",
    "chainId": 1,
    "verifyingContract": "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC"
  },
  "message": {
    "from": { "name": "Cow", "wallet": "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826", "age": 20 },
    "to":   { "name": "Bob", "wallet": "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB", "age": "0x1e" },
    "contents": "Hello, Bob!",
    "attachments": [{ "contents": "attachment1" }, { "contents": "attachment2" }]
  }
}`;

function EthSignTypedMessage({ bb02 }: Props) {
  const [chainID, setChainID] = useState(1);
  const [keypath, setKeypath] = useState("m/44'/60'/0'/0/0");
  const [msg, setMsg] = useState(EXAMPLE_TYPED_MSG);
  const [useAntiklepto, setUseAntiklepto] = useState(true);
  const [result, setResult] = useState<bitbox.EthSignature | undefined>();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setResult(undefined);
    setErr(undefined);
    try {
      setResult(
        await bb02.ethSignTypedMessage(BigInt(chainID), keypath, JSON.parse(msg), useAntiklepto),
      );
    } catch (e2) {
      setErr(bitbox.ensureError(e2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Sign Typed Message (EIP-712)</h4>
      <form className="verticalForm" onSubmit={submitForm}>
        <label>
          Chain ID
          <input
            type="number"
            value={chainID}
            onChange={e => setChainID(Number.parseInt(e.target.value, 10))}
          />
        </label>
        <label>
          Keypath
          <input type="text" value={keypath} onChange={e => setKeypath(e.target.value)} />
        </label>
        <label>
          Use anti-klepto
          <input
            type="checkbox"
            checked={useAntiklepto}
            onChange={e => setUseAntiklepto(e.target.checked)}
          />
        </label>
        <label>EIP-712 typed message</label>
        <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={20} />
        <button type="submit" disabled={running}>Sign typed message</button>
        <ResultBlock value={formatResult(result)} />
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </div>
  );
}

const STREAMING_THRESHOLD = 6144;
const DEFAULT_STREAMING_BYTES = 7000;

function generateLargeHex(bytes: number): string {
  const out: string[] = [];
  for (let i = 0; i < bytes; i += 1) {
    out.push((i & 0xff).toString(16).padStart(2, '0'));
  }
  return out.join('');
}

function EthSign1559TransactionStreaming({ bb02 }: Props) {
  const [chainID, setChainID] = useState(1);
  const [keypath, setKeypath] = useState("m/44'/60'/0'/0/0");
  const [dataLen, setDataLen] = useState(DEFAULT_STREAMING_BYTES);
  const [result, setResult] = useState<bitbox.EthSignature | undefined>();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setResult(undefined);
    setErr(undefined);
    try {
      const tx: bitbox.Eth1559Transaction = {
        chainId: chainID,
        nonce: hexToBytes('1fdc'),
        maxPriorityFeePerGas: hexToBytes('3b9aca00'),
        maxFeePerGas: hexToBytes('04a817c800'),
        gasLimit: hexToBytes('5208'),
        recipient: hexToBytes('04f264cf34440313b4a0192a352814fbe927b885'),
        value: hexToBytes('075cf1259e9c4000'),
        data: hexToBytes(generateLargeHex(dataLen)),
      };
      setResult(await bb02.ethSign1559Transaction(keypath, tx, 'mixed'));
    } catch (e2) {
      setErr(bitbox.ensureError(e2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Sign EIP-1559 Transaction (streaming)</h4>
      <p className="portNote">
        Generates a tx with <code>{dataLen}</code> bytes of data; values above{' '}
        {STREAMING_THRESHOLD} trigger the chunked <code>dataRequestChunk</code> path. Requires
        firmware ≥9.26.0.
      </p>
      <form className="verticalForm" onSubmit={submitForm}>
        <label>
          Chain ID
          <input
            type="number"
            value={chainID}
            onChange={e => setChainID(Number.parseInt(e.target.value, 10))}
          />
        </label>
        <label>
          Keypath
          <input type="text" value={keypath} onChange={e => setKeypath(e.target.value)} />
        </label>
        <label>
          Data size (bytes)
          <input
            type="number"
            value={dataLen}
            onChange={e => setDataLen(Number.parseInt(e.target.value, 10))}
            min={0}
          />
        </label>
        <button type="submit" disabled={running}>Sign streaming transaction</button>
        <ResultBlock value={formatResult(result)} />
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </div>
  );
}

function EthSignTypedMessageStreaming({ bb02 }: Props) {
  const [chainID, setChainID] = useState(1);
  const [keypath, setKeypath] = useState("m/44'/60'/0'/0/0");
  const [blobLen, setBlobLen] = useState(DEFAULT_STREAMING_BYTES);
  const [result, setResult] = useState<bitbox.EthSignature | undefined>();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setResult(undefined);
    setErr(undefined);
    try {
      const message = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
          ],
          BigBlob: [{ name: 'payload', type: 'bytes' }],
        },
        primaryType: 'BigBlob',
        domain: { name: 'Streaming Demo', version: '1', chainId: chainID },
        message: { payload: '0x' + generateLargeHex(blobLen) },
      };
      setResult(await bb02.ethSignTypedMessage(BigInt(chainID), keypath, message, true));
    } catch (e2) {
      setErr(bitbox.ensureError(e2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Sign Typed Message (streaming)</h4>
      <p className="portNote">
        Signs an EIP-712 message whose <code>bytes payload</code> field is{' '}
        <code>{blobLen}</code> bytes; values above {STREAMING_THRESHOLD} stream via{' '}
        <code>dataRequestChunk</code>. String values over {STREAMING_THRESHOLD} are rejected by
        design — use <code>bytes</code> to exercise streaming.
      </p>
      <form className="verticalForm" onSubmit={submitForm}>
        <label>
          Chain ID
          <input
            type="number"
            value={chainID}
            onChange={e => setChainID(Number.parseInt(e.target.value, 10))}
          />
        </label>
        <label>
          Keypath
          <input type="text" value={keypath} onChange={e => setKeypath(e.target.value)} />
        </label>
        <label>
          Payload size (bytes)
          <input
            type="number"
            value={blobLen}
            onChange={e => setBlobLen(Number.parseInt(e.target.value, 10))}
            min={0}
          />
        </label>
        <button type="submit" disabled={running}>Sign streaming typed message</button>
        <ResultBlock value={formatResult(result)} />
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </div>
  );
}

export function Ethereum({ bb02 }: Props) {
  return (
    <>
      <div className="action"><EthXPub bb02={bb02} /></div>
      <div className="action"><EthAddress bb02={bb02} /></div>
      <div className="action"><EthSign1559Transaction bb02={bb02} /></div>
      <div className="action"><EthSign1559TransactionStreaming bb02={bb02} /></div>
      <div className="action"><EthSignTransaction bb02={bb02} /></div>
      <div className="action"><EthSignMessage bb02={bb02} /></div>
      <div className="action"><EthSignTypedMessage bb02={bb02} /></div>
      <div className="action"><EthSignTypedMessageStreaming bb02={bb02} /></div>
    </>
  );
}
