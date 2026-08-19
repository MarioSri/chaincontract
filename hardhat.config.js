import hardhatEthersPlugin from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchersPlugin from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMochaPlugin from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpersPlugin from "@nomicfoundation/hardhat-network-helpers";
import hardhatTypechainPlugin from "@nomicfoundation/hardhat-typechain";
/** @type {import("hardhat/config").HardhatUserConfig} */
export default {
  plugins: [
    hardhatEthersPlugin,
    hardhatEthersChaiMatchersPlugin,
    hardhatMochaPlugin,
    hardhatNetworkHelpersPlugin,
    hardhatTypechainPlugin,
  ],
  mocha: {
    spec: "test/**/*.test.js",
  },
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      // Auto-mine a block every 2s so UI interactions feel instant while
      // still exercising the event/confirmation flow.
      blockTime: 2,
    },
    // The long-running daemon node (`npx hardhat node`) the client UI talks
    // to. Deploy with `--network local` so the UI address file points at the
    // same runtime the frontend uses.
    local: {
      type: "http",
      url: "http://localhost:8545",
    },
  },
};
