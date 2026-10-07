# Demo WebApp project

A live deployment of this demo can be found here: https://bitboxswiss.github.io/bitbox-api-ts/.

This folder contains a React project showcasing the TypeScript API. It uses the bitbox-api library
in `../src` through the Vite alias in [./vite.config.ts](./vite.config.ts).

The main entry point of the sandbox is at [./src/App.tsx](./src/App.tsx).

The full package API is described by the TypeScript definitions file `../dist/index.d.ts` after
running `npm run build`.

Install the deps from the repository root using:

    npm ci

Run the sandbox from the repository root using:

    npm run sandbox:dev

Hot-reloading is supported - you can change the library source or sandbox files without restarting
the server.

To build the sandbox from the repository root:

    npm run sandbox:build
