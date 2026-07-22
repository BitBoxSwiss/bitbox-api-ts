// SPDX-License-Identifier: Apache-2.0

import { type FormEvent, useState } from 'react';
import * as bitbox from '@bitboxswiss/bitbox-api';

import { ErrorNotification } from './ErrorNotification';
import { ResultBlock, formatResult } from './form-utils';

type Props = { bb02: bitbox.PairedBitBox };

const BTC_COINS: bitbox.BtcCoin[] = ['btc', 'tbtc', 'ltc', 'tltc', 'rbtc'];
const XPUB_TYPES: bitbox.XPubType[] = [
  'tpub', 'xpub', 'ypub', 'zpub', 'vpub', 'upub', 'Vpub', 'Zpub', 'Upub', 'Ypub',
];
const SIMPLE_TYPES: bitbox.BtcSimpleType[] = ['p2wpkhP2sh', 'p2wpkh', 'p2tr'];

function ErrorView({
  error,
  clear,
}: {
  error: bitbox.Error | undefined;
  clear: () => void;
}) {
  return error === undefined
    ? null
    : <ErrorNotification message={error.message} code={error.code} onClose={clear} />;
}

function CoinSelect({
  coin,
  setCoin,
}: {
  coin: bitbox.BtcCoin;
  setCoin: (coin: bitbox.BtcCoin) => void;
}) {
  return (
    <label>
      Coin
      <select value={coin} onChange={event => setCoin(event.target.value as bitbox.BtcCoin)}>
        {BTC_COINS.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function BtcXPub({ bb02 }: Props) {
  const [coin, setCoin] = useState<bitbox.BtcCoin>('btc');
  const [keypath, setKeypath] = useState("m/84'/0'/0'");
  const [xpubType, setXpubType] = useState<bitbox.XPubType>('xpub');
  const [display, setDisplay] = useState(true);
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<bitbox.Error>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setRunning(true);
    setResult('');
    setError(undefined);
    try {
      setResult(await bb02.btcXpub(coin, keypath, xpubType, display));
    } catch (err) {
      setError(bitbox.ensureError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>XPub</h4>
      <form className="verticalForm" onSubmit={submit}>
        <CoinSelect coin={coin} setCoin={setCoin} />
        <label>
          Keypath
          <input value={keypath} onChange={event => setKeypath(event.target.value)} />
        </label>
        <label>
          XPub type
          <select
            value={xpubType}
            onChange={event => setXpubType(event.target.value as bitbox.XPubType)}
          >
            {XPUB_TYPES.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          Display on device
          <input
            type="checkbox"
            checked={display}
            onChange={event => setDisplay(event.target.checked)}
          />
        </label>
        <button type="submit" disabled={running}>Get XPub</button>
        <ResultBlock value={result} />
        <ErrorView error={error} clear={() => setError(undefined)} />
      </form>
    </div>
  );
}

function BtcXPubs({ bb02 }: Props) {
  const [coin, setCoin] = useState<bitbox.BtcCoin>('btc');
  const [keypaths, setKeypaths] = useState(
    `["m/49'/0'/0'", "m/84'/0'/0'", "m/86'/0'/0'"]`,
  );
  const [xpubType, setXpubType] = useState<bitbox.BtcXPubsType>('xpub');
  const [result, setResult] = useState<bitbox.BtcXpubs>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<bitbox.Error>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setRunning(true);
    setResult(undefined);
    setError(undefined);
    try {
      setResult(await bb02.btcXpubs(
        coin,
        JSON.parse(keypaths) as bitbox.Keypath[],
        xpubType,
      ));
    } catch (err) {
      setError(bitbox.ensureError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Multiple XPubs</h4>
      <form className="verticalForm" onSubmit={submit}>
        <CoinSelect coin={coin} setCoin={setCoin} />
        <label>Keypaths</label>
        <textarea value={keypaths} onChange={event => setKeypaths(event.target.value)} rows={5} />
        <label>
          XPub type
          <select
            value={xpubType}
            onChange={event => setXpubType(event.target.value as bitbox.BtcXPubsType)}
          >
            <option value="tpub">tpub</option>
            <option value="xpub">xpub</option>
          </select>
        </label>
        <button type="submit" disabled={running}>Get XPubs</button>
        <ResultBlock value={formatResult(result)} />
        <ErrorView error={error} clear={() => setError(undefined)} />
      </form>
    </div>
  );
}

function BtcAddressSimple({ bb02 }: Props) {
  const [coin, setCoin] = useState<bitbox.BtcCoin>('btc');
  const [simpleType, setSimpleType] = useState<bitbox.BtcSimpleType>('p2wpkhP2sh');
  const [display, setDisplay] = useState(true);
  const [isChange, setIsChange] = useState(false);
  const [addressIndex, setAddressIndex] = useState(0);
  const [account, setAccount] = useState(0);
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<bitbox.Error>();

  const coinType = coin === 'btc' ? 0 : coin === 'ltc' ? 2 : 1;
  const purpose = simpleType === 'p2wpkhP2sh' ? 49 : simpleType === 'p2wpkh' ? 84 : 86;
  const keypath = `m/${purpose}'/${coinType}'/${account}'/${isChange ? 1 : 0}/${addressIndex}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setRunning(true);
    setResult('');
    setError(undefined);
    try {
      setResult(await bb02.btcAddress(coin, keypath, { simpleType }, display));
    } catch (err) {
      setError(bitbox.ensureError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Address</h4>
      <form className="verticalForm" onSubmit={submit}>
        <CoinSelect coin={coin} setCoin={setCoin} />
        <label>
          Simple type
          <select
            value={simpleType}
            onChange={event => setSimpleType(event.target.value as bitbox.BtcSimpleType)}
          >
            {SIMPLE_TYPES.map(option => (
              <option
                key={option}
                value={option}
                disabled={option === 'p2tr' && (coin === 'ltc' || coin === 'tltc')}
              >
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          Account
          <input
            type="number"
            min="0"
            value={account}
            onChange={event => setAccount(Number(event.target.value))}
          />
        </label>
        <label>
          Change
          <input
            type="checkbox"
            checked={isChange}
            onChange={event => setIsChange(event.target.checked)}
          />
        </label>
        <label>
          Address index
          <input
            type="number"
            min="0"
            value={addressIndex}
            onChange={event => setAddressIndex(Number(event.target.value))}
          />
        </label>
        <label>
          Display on device
          <input
            type="checkbox"
            checked={display}
            onChange={event => setDisplay(event.target.checked)}
          />
        </label>
        <p>Keypath: <code>{keypath}</code></p>
        <button type="submit" disabled={running}>Get address</button>
        <ResultBlock value={result} />
        <ErrorView error={error} clear={() => setError(undefined)} />
      </form>
    </div>
  );
}

function BtcSignPSBT({ bb02 }: Props) {
  const [coin, setCoin] = useState<bitbox.BtcCoin>('btc');
  const [psbt, setPSBT] = useState('');
  const [formatUnit, setFormatUnit] = useState<bitbox.BtcFormatUnit>('default');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<bitbox.Error>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setRunning(true);
    setResult('');
    setError(undefined);
    try {
      setResult(await bb02.btcSignPSBT(coin, psbt, undefined, formatUnit));
    } catch (err) {
      setError(bitbox.ensureError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Sign PSBT</h4>
      <form className="verticalForm" onSubmit={submit}>
        <CoinSelect coin={coin} setCoin={setCoin} />
        <label>
          Format unit
          <select
            value={formatUnit}
            onChange={event => setFormatUnit(event.target.value as bitbox.BtcFormatUnit)}
          >
            <option value="default">default</option>
            <option value="sat">sat</option>
          </select>
        </label>
        <label>PSBT</label>
        <textarea
          value={psbt}
          onChange={event => setPSBT(event.target.value)}
          placeholder="base64 PSBT"
          rows={8}
        />
        <button type="submit" disabled={running}>Sign PSBT</button>
        <ResultBlock value={result} />
        <ErrorView error={error} clear={() => setError(undefined)} />
      </form>
    </div>
  );
}

function BtcSignMessage({ bb02 }: Props) {
  const [simpleType, setSimpleType] = useState<bitbox.BtcSimpleType>('p2wpkhP2sh');
  const [keypath, setKeypath] = useState("m/49'/0'/0'/0/0");
  const [message, setMessage] = useState('message');
  const [result, setResult] = useState<bitbox.BtcSignMessageSignature>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<bitbox.Error>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setRunning(true);
    setResult(undefined);
    setError(undefined);
    try {
      setResult(await bb02.btcSignMessage(
        'btc',
        { scriptConfig: { simpleType }, keypath },
        new TextEncoder().encode(message),
      ));
    } catch (err) {
      setError(bitbox.ensureError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Sign message</h4>
      <form className="verticalForm" onSubmit={submit}>
        <label>
          Simple type
          <select
            value={simpleType}
            onChange={event => setSimpleType(event.target.value as bitbox.BtcSimpleType)}
          >
            <option value="p2wpkhP2sh">p2wpkhP2sh</option>
            <option value="p2wpkh">p2wpkh</option>
          </select>
        </label>
        <label>
          Keypath
          <input value={keypath} onChange={event => setKeypath(event.target.value)} />
        </label>
        <label>Message</label>
        <textarea value={message} onChange={event => setMessage(event.target.value)} rows={4} />
        <button type="submit" disabled={running}>Sign message</button>
        <ResultBlock value={formatResult(result)} />
        <ErrorView error={error} clear={() => setError(undefined)} />
      </form>
    </div>
  );
}

function BtcMultisigAddress({ bb02 }: Props) {
  const [scriptType, setScriptType] = useState<bitbox.BtcMultisigScriptType>('p2wsh');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<bitbox.Error>();
  const coin: bitbox.BtcCoin = 'tbtc';
  const keypath = "m/48'/1'/0'/2'";
  const otherXpub = 'tpubDFgycCkexSxkdZfeyaasDHityE97kiYM1BeCNoivDHvydGugKtoNobt4vEX6YSHNPy2cqmWQHKjKxciJuocepsGPGxcDZVmiMBnxgA1JKQk';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setRunning(true);
    setResult('');
    setError(undefined);
    try {
      const ourXpub = await bb02.btcXpub(coin, keypath, 'tpub', false);
      const config: bitbox.BtcScriptConfig = {
        multisig: {
          threshold: 1,
          xpubs: [ourXpub, otherXpub],
          ourXpubIndex: 0,
          scriptType,
        },
      };
      if (!await bb02.btcIsScriptConfigRegistered(coin, config, keypath)) {
        await bb02.btcRegisterScriptConfig(
          coin,
          config,
          keypath,
          'autoXpubTpub',
          undefined,
        );
      }
      setResult(await bb02.btcAddress(coin, `${keypath}/0/10`, config, true));
    } catch (err) {
      setError(bitbox.ensureError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Multisig address</h4>
      <form className="verticalForm" onSubmit={submit}>
        <label>
          Script type
          <select
            value={scriptType}
            onChange={event => setScriptType(
              event.target.value as bitbox.BtcMultisigScriptType,
            )}
          >
            <option value="p2wsh">p2wsh</option>
            <option value="p2wshP2sh">p2wshP2sh</option>
          </select>
        </label>
        <p>Account keypath: <code>{keypath}</code></p>
        <button type="submit" disabled={running}>Get multisig address</button>
        <ResultBlock value={result} />
        <ErrorView error={error} clear={() => setError(undefined)} />
      </form>
    </div>
  );
}

function BtcPolicyAddress({ bb02 }: Props) {
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<bitbox.Error>();
  const coin: bitbox.BtcCoin = 'tbtc';
  const policy = 'wsh(andor(pk(@0/**),older(12960),pk(@1/**)))';
  const keypath = "m/48'/1'/0'/3'";
  const otherXpub = 'tpubDFgycCkexSxkdZfeyaasDHityE97kiYM1BeCNoivDHvydGugKtoNobt4vEX6YSHNPy2cqmWQHKjKxciJuocepsGPGxcDZVmiMBnxgA1JKQk';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setRunning(true);
    setResult('');
    setError(undefined);
    try {
      const rootFingerprint = await bb02.rootFingerprint();
      const ourXpub = await bb02.btcXpub(coin, keypath, 'xpub', false);
      const config: bitbox.BtcScriptConfig = {
        policy: {
          policy,
          keys: [
            { rootFingerprint, keypath, xpub: ourXpub },
            { xpub: otherXpub },
          ],
        },
      };
      if (!await bb02.btcIsScriptConfigRegistered(coin, config, undefined)) {
        await bb02.btcRegisterScriptConfig(
          coin,
          config,
          undefined,
          'autoXpubTpub',
          undefined,
        );
      }
      setResult(await bb02.btcAddress(coin, `${keypath}/0/10`, config, true));
    } catch (err) {
      setError(bitbox.ensureError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h4>Policy address</h4>
      <form className="verticalForm" onSubmit={submit}>
        <p>Policy: <code>{policy}</code></p>
        <p>Account keypath: <code>{keypath}</code></p>
        <button type="submit" disabled={running}>Get policy address</button>
        <ResultBlock value={result} />
        <ErrorView error={error} clear={() => setError(undefined)} />
      </form>
    </div>
  );
}

export function Bitcoin({ bb02 }: Props) {
  return (
    <>
      <div className="action"><BtcXPub bb02={bb02} /></div>
      <div className="action"><BtcXPubs bb02={bb02} /></div>
      <div className="action"><BtcAddressSimple bb02={bb02} /></div>
      <div className="action"><BtcSignPSBT bb02={bb02} /></div>
      <div className="action"><BtcSignMessage bb02={bb02} /></div>
      <div className="action"><BtcMultisigAddress bb02={bb02} /></div>
      <div className="action"><BtcPolicyAddress bb02={bb02} /></div>
    </>
  );
}
