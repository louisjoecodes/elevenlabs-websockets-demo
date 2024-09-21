import type { Metadata } from "next";
import localFont from "next/font/local";
import Image from "next/image";
import Link from "next/link";
import { ReactNode } from "react";

import { GitHubLogoIcon } from "@radix-ui/react-icons";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import Logo from "@/public/logo.png";

import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Elevenlabs",
  description: "Websockets chat app with text highlighting",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="flex flex-col min-h-screen">
          <div className="relative flex flex-col min-h-screen">
            <div
              className="absolute inset-0 bg-contain bg-no-repeat bg-bottom opacity-30 z-0"
              style={{ backgroundImage: "url('/background.png')" }}
            />
            <div className="relative z-10 flex flex-col min-h-screen">
              <header className="sticky top-0 z-50 flex items-center justify-between w-full h-16 px-4 border-b shrink-0 bg-gradient-to-b from-background/10 via-background/50 to-background/80 backdrop-blur-xl">
                <div className="flex items-center">
                  <Link href="/">
                    <Image src={Logo} alt="Logo" width={100} height={32} />
                  </Link>
                </div>
                <div className="flex items-center justify-end space-x-2">
                  <a
                    href="https://github.com/elevenlabs/elevenlabs-examples"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "outline" }))}
                  >
                    <GitHubLogoIcon />
                    <span className="hidden ml-2 md:flex">GitHub</span>
                  </a>
                </div>
              </header>
              <main className="flex flex-col flex-1 bg-muted/50">
                {children}
              </main>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
