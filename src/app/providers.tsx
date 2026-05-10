"use client";

import { useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import {
  mainnet,
  sepolia,
  base,
  baseSepolia,
  arbitrum,
  optimism,
  polygon,
} from "wagmi/chains";
import { RainbowKitProvider, getDefaultConfig, darkTheme } from "@rainbow-me/rainbowkit";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider as SolanaModalProvider } from "@solana/wallet-adapter-react-ui";
import { AuthProvider } from "@/lib/auth-context";

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "00000000000000000000000000000000";

// Every EVM chain we know how to deposit / claim / refund on. Registering
// a chain here is what lets wagmi's `switchChain` switch to it; if a chain
// is missing from this list, every action that touches it errors with
// `ChainNotConfiguredError` ("Chain not configured").
//
// All chains are registered unconditionally so the app works on whichever
// chain the user configures an escrow for, without code edits per chain.
// Chains the user hasn't configured an escrow for are simply not selected
// by the form (NEXT_PUBLIC_DEFAULT_EVM_CHAIN_ID picks the active one).
const supportedChains = [
  mainnet,
  sepolia,
  base,
  baseSepolia,
  arbitrum,
  optimism,
  polygon,
] as const;

const transports = {
  [mainnet.id]: http(process.env.NEXT_PUBLIC_ETH_RPC_URL),
  [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL),
  [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
  [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
  [arbitrum.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL),
  [optimism.id]: http(process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL),
  [polygon.id]: http(process.env.NEXT_PUBLIC_POLYGON_RPC_URL),
};

const wagmiConfig = getDefaultConfig({
  appName: "Pay to Chat",
  projectId,
  chains: supportedChains,
  ssr: true,
  transports,
});

const fallbackConfig = createConfig({
  chains: supportedChains,
  transports,
});

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), []);
  const solanaEndpoint =
    process.env.NEXT_PUBLIC_SOL_RPC_URL || "https://api.mainnet-beta.solana.com";
  const config = projectId === "00000000000000000000000000000000" ? fallbackConfig : wagmiConfig;

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#7c5cff",
            accentColorForeground: "white",
            borderRadius: "large",
          })}
          modalSize="compact"
        >
          <ConnectionProvider endpoint={solanaEndpoint}>
            <SolanaWalletProvider wallets={[]} autoConnect>
              <SolanaModalProvider>
                <AuthProvider>{children}</AuthProvider>
              </SolanaModalProvider>
            </SolanaWalletProvider>
          </ConnectionProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
