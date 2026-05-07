"use client";

import { useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { RainbowKitProvider, getDefaultConfig, darkTheme } from "@rainbow-me/rainbowkit";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider as SolanaModalProvider } from "@solana/wallet-adapter-react-ui";
import { AuthProvider } from "@/lib/auth-context";

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "00000000000000000000000000000000";

const wagmiConfig = getDefaultConfig({
  appName: "Pay to Chat",
  projectId,
  chains: [mainnet],
  ssr: true,
  transports: {
    [mainnet.id]: http(process.env.NEXT_PUBLIC_ETH_RPC_URL),
  },
});

const fallbackConfig = createConfig({
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
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
