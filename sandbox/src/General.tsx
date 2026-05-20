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

export function General({ bb02 }: Props) {
  return (
    <>
      <div className="action">
        <RootFingerprint bb02={bb02} />
      </div>
      <div className="action">
        <DeviceInfo bb02={bb02} />
      </div>
    </>
  );
}
