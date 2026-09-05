// SPDX-License-Identifier: Apache-2.0

import { FormEvent, useState } from 'react';
import * as bitbox from '@bitboxswiss/bitbox-api';

import { ErrorNotification } from './ErrorNotification';

type Props = { bb02: bitbox.PairedBitBox };

function RootFingerprint({ bb02 }: Props) {
  const [rootFingerprint, setRootFingerprint] = useState('');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setRootFingerprint('');
    setErr(undefined);
    try {
      setRootFingerprint(await bb02.rootFingerprint());
    } catch (e2) {
      setErr(bitbox.ensureError(e2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <h4>Root Fingerprint</h4>
      <form className="verticalForm" onSubmit={submitForm}>
        <button type="submit" disabled={running}>Show</button>
        {rootFingerprint !== '' && (
          <div className="resultContainer">
            <label>
              Result: <b><code>{rootFingerprint}</code></b>
            </label>
          </div>
        )}
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </>
  );
}

function DeviceInfo({ bb02 }: Props) {
  const [deviceInfo, setDeviceInfo] = useState<bitbox.DeviceInfo>();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setDeviceInfo(undefined);
    setErr(undefined);
    try {
      setDeviceInfo(await bb02.deviceInfo());
    } catch (e2) {
      setErr(bitbox.ensureError(e2));
    } finally {
      setRunning(false);
    }
  };

  const parsedDeviceInfo = deviceInfo ? JSON.stringify(deviceInfo, undefined, 2) : '';

  return (
    <>
      <h4>Device Info</h4>
      <form className="verticalForm" onSubmit={submitForm}>
        <button type="submit" disabled={running}>Show</button>
        {deviceInfo !== undefined && (
          <div className="resultContainer">
            <label>Result</label>
            <textarea
              rows={parsedDeviceInfo.split('\n').length}
              readOnly
              defaultValue={parsedDeviceInfo}
            />
          </div>
        )}
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </>
  );
}

function ShowMnemonic({ bb02 }: Props) {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const actionShowMnemonic = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setErr(undefined);
    try {
      await bb02.showMnemonic();
    } catch (err) {
      setErr(bitbox.ensureError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <h4>Recovery Words</h4>
      <form className="verticalForm" onSubmit={actionShowMnemonic}>
        <button type="submit" disabled={running}>Show recovery words</button>
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </>
  );
}

function ChangePassword({ bb02 }: Props) {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const actionChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setErr(undefined);
    try {
      await bb02.changePassword();
    } catch (err) {
      setErr(bitbox.ensureError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <h4>Change Password</h4>
      <form className="verticalForm" onSubmit={actionChangePassword}>
        <button type="submit" disabled={running}>Change password</button>
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </>
  );
}

function Bip85AppBip39({ bb02 }: Props) {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<bitbox.Error>();

  const actionBip85 = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setErr(undefined);
    try {
      await bb02.bip85AppBip39();
    } catch (err) {
      setErr(bitbox.ensureError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <h4>BIP-85</h4>
      <form className="verticalForm" onSubmit={actionBip85}>
        <button type="submit" disabled={running}>Invoke BIP-85 (BIP-39 app)</button>
        {err !== undefined && (
          <ErrorNotification message={err.message} code={err.code} onClose={() => setErr(undefined)} />
        )}
      </form>
    </>
  );
}

export function General({ bb02 }: Props) {
  return (
    <>
      <div className="action">
        <RootFingerprint bb02={bb02} />
      </div>
      <div className="action">
        <DeviceInfo bb02={bb02} />
      </div>
      <div className="action">
        <ShowMnemonic bb02={bb02} />
      </div>
      <div className="action">
        <Bip85AppBip39 bb02={bb02} />
      </div>
      <div className="action">
        <ChangePassword bb02={bb02} />
      </div>
    </>
  );
}
