"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { CornerDownLeft, PlusIcon, UserIcon } from "lucide-react";

import ElevenLabsIcon from "@/public/icon.png";

interface BaseMessage {
  id: string;
  role: "user" | "system";
}

interface UserMessage extends BaseMessage {
  role: "user";
  content: string;
}

interface SystemMessage extends BaseMessage {
  role: "system";
  words: string[];
  wordStartTimesMs: number[];
}

export default function IndexPage() {
  // State hooks
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<(UserMessage | SystemMessage)[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);

  // Refs
  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);

  // Flags to manage async operations
  const isAppendingRef = useRef<boolean>(false);
  const isCancelledRef = useRef<boolean>(false);
  const appendQueueRef = useRef<Uint8Array[]>([]);
  const sessionIdRef = useRef<number>(0); // Unique session identifier

  useEffect(() => {
    // Add event listeners to the audio element to keep track of the current time
    const audioElement = audioRef.current;
    if (audioElement) {
      const handleTimeUpdate = () => {
        setCurrentTime(audioElement.currentTime * 1000);
      };

      const handleEnded = () => {
        setPlayingMessageId(null);
      };

      audioElement.addEventListener("timeupdate", handleTimeUpdate);
      audioElement.addEventListener("ended", handleEnded);

      return () => {
        audioElement.removeEventListener("timeupdate", handleTimeUpdate);
        audioElement.removeEventListener("ended", handleEnded);
      };
    }
  }, []);

  // Handle word click to seek audio
  const handleWordClick = useCallback(
    (messageId: string, startTime: number) => {
      const lastSystemMessage = messages
        .slice()
        .reverse()
        .find((msg) => msg.role === "system");
      if (
        lastSystemMessage &&
        messageId === lastSystemMessage.id &&
        audioRef.current
      ) {
        audioRef.current.currentTime = startTime / 1000;
        audioRef.current.play().catch(console.error);
        setPlayingMessageId(messageId);
      }
    },
    [messages]
  );

  const sendMessage = async () => {
    // Clear the input
    setInput("");

    // Increment audio session ID
    sessionIdRef.current += 1;
    const currentSessionId = sessionIdRef.current;

    // Reset the cancellation flag
    isCancelledRef.current = false;

    // Reset the audio player
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      if (mediaSourceRef.current) {
        if (mediaSourceRef.current.readyState === "open") {
          try {
            mediaSourceRef.current.endOfStream();
          } catch (e) {
            console.warn("MediaSource already ended:", e);
          }
        }
        mediaSourceRef.current = null;
      }
      audioRef.current.src = "";
    }

    // Clear the append queue
    appendQueueRef.current = [];

    // Set up new MediaSource
    mediaSourceRef.current = new MediaSource();
    audioRef.current!.src = URL.createObjectURL(mediaSourceRef.current);
    sourceBufferRef.current = null;

    mediaSourceRef.current.addEventListener("sourceopen", () => {
      if (!sourceBufferRef.current) {
        sourceBufferRef.current = mediaSourceRef.current!.addSourceBuffer(
          "audio/mpeg"
        );
      }
    });

    // Store the user message
    const userMessage: UserMessage = {
      id: nanoid(),
      role: "user",
      content: input,
    };
    setMessages((prev) => [...prev, userMessage]);

    // Prepare the chat context
    const chatContext = [
      ...messages.map((msg) => ({
        role: msg.role,
        content: msg.role === "user" ? msg.content : msg.words.join(" "),
      })),
      { role: "user", content: input },
    ];

    // Add a placeholder for the bot message
    const botMessageId = nanoid();
    setPlayingMessageId(botMessageId);
    const botMessage: SystemMessage = {
      id: botMessageId,
      role: "system",
      words: [],
      wordStartTimesMs: [],
    };
    setMessages((prev) => [...prev, botMessage]);

    try {
      const response = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatContext }),
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Failed to get response reader");

      const appendToSourceBuffer = async () => {
        if (
          isAppendingRef.current ||
          appendQueueRef.current.length === 0 ||
          !sourceBufferRef.current ||
          isCancelledRef.current ||
          sessionIdRef.current !== currentSessionId // Check session ID
        )
          return;
        isAppendingRef.current = true;
        const data = appendQueueRef.current.shift()!;
        try {
          sourceBufferRef.current.appendBuffer(data);
        } catch (error) {
          console.error("Error appending buffer:", error);
          isAppendingRef.current = false;
          return;
        }
        await new Promise<void>((resolve) => {
          sourceBufferRef.current!.onupdateend = () => {
            isAppendingRef.current = false;
            resolve();
            appendToSourceBuffer();
          };
        });
      };

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done || isCancelledRef.current || sessionIdRef.current !== currentSessionId) break;

        buffer += new TextDecoder().decode(value);
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          if (event.startsWith("data: ")) {
            try {
              const data = JSON.parse(event.slice(6));
              switch (data.type) {
                // Handle audio stream
                case "audio": {
                  const audioData = Uint8Array.from(
                    atob(data.data),
                    (c) => c.charCodeAt(0)
                  );
                  appendQueueRef.current.push(audioData);
                  appendToSourceBuffer();
                  if (audioRef.current?.paused) {
                    audioRef.current.play().catch(console.error);
                  }
                  break;
                }
                // Handle metadata stream
                case "word_times": {
                  const newWords = data.data.words;
                  const newWordStartTimes = data.data.wordStartTimesMs;
                  setMessages((prev) =>
                    prev.map((message) => {
                      if (message.id === botMessageId) {
                        const botMessage = message as SystemMessage;
                        return {
                          ...botMessage,
                          words: [...botMessage.words, ...newWords],
                          wordStartTimesMs: [
                            ...botMessage.wordStartTimesMs,
                            ...newWordStartTimes,
                          ],
                        };
                      } else {
                        return message;
                      }
                    })
                  );
                  break;
                }
              }
            } catch (error) {
              console.error("Error parsing event data:", error);
            }
          }
        }
      }

      // Wait for remaining appends to complete
      while (
        (appendQueueRef.current.length > 0 || isAppendingRef.current) &&
        !isCancelledRef.current &&
        sessionIdRef.current === currentSessionId
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (
        sourceBufferRef.current &&
        mediaSourceRef.current?.readyState === "open" &&
        !isCancelledRef.current &&
        sessionIdRef.current === currentSessionId
      ) {
        try {
          mediaSourceRef.current.endOfStream();
        } catch (e) {
          console.warn("MediaSource already ended:", e);
        }
      }
    } catch (error) {
      if (!isCancelledRef.current) {
        console.error("Error in sendMessage:", error);
      }
    }
  };

  const resetConversation = () => {
    // Cancel any ongoing operations
    isCancelledRef.current = true;
    sessionIdRef.current += 1; // Increment session ID to invalidate previous sessions

    setInput("");
    setMessages([]);
    setCurrentTime(0);
    setPlayingMessageId(null);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      if (mediaSourceRef.current?.readyState === "open") {
        try {
          mediaSourceRef.current.endOfStream();
        } catch (e) {
          console.warn("MediaSource already ended:", e);
        }
      }
      mediaSourceRef.current = null;
      sourceBufferRef.current = null;
      audioRef.current.src = "";
    }

    // Clear the queue
    appendQueueRef.current = [];
  };

  return (
    <div className="group w-full overflow-auto pl-0">
      <div className={cn("pb-[200px] pt-4 md:pt-10")}>
        {messages.length ? (
          <div className="relative mx-auto max-w-2xl px-4">
            {messages.map((message, index) => (
              <div key={message.id}>
                <div className="group relative flex items-start md:-ml-12">
                  <div
                    className={cn(
                      "flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-md border shadow-sm",
                      message.role === "user"
                        ? "bg-background"
                        : "bg-primary text-primary-foreground"
                    )}
                  >
                    {message.role === "user" ? (
                      <UserIcon className="h-3 w-3" />
                    ) : (
                      <Image
                        src={ElevenLabsIcon}
                        alt="ElevenLabsIcon"
                        width={24}
                        height={24}
                      />
                    )}
                  </div>
                  <div className="ml-4 flex-1 space-y-2 overflow-hidden pl-2">
                    {message.role === "user" ? (
                      <p>{message.content}</p>
                    ) : (
                      <BotMessageComponent
                        messageId={message.id}
                        words={message.words}
                        wordStartTimesMs={message.wordStartTimesMs}
                        currentTime={currentTime}
                        onWordClick={handleWordClick}
                        isPlaying={playingMessageId === message.id}
                        isClickable={
                          message.id ===
                          messages[messages.length - 1]?.id
                        }
                      />
                    )}
                  </div>
                </div>
                {index < messages.length - 1 && (
                  <Separator className="my-4" />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto max-w-2xl px-4">
            <div className="flex flex-col gap-2 rounded-lg border bg-background p-8">
              <h1 className="text-lg font-semibold">
                Welcome to the ElevenLabs Chatbot
              </h1>
              <p className="leading-normal text-muted-foreground">
                This is an open-source AI chatbot app template, with voice
                powered by ElevenLabs.
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="fixed inset-x-0 bottom-0 w-full bg-gradient-to-b from-muted/30 to-muted/30">
        <div className="mx-auto sm:max-w-2xl sm:px-4">
          <div className="space-y-4 border-t bg-background px-4 py-2 shadow-lg sm:rounded-t-xl md:py-4">
            <div className="relative flex max-h-60 w-full flex-col overflow-hidden bg-background px-8 sm:rounded-md sm:border sm:px-12">
              <Button
                variant="outline"
                size="icon"
                className="absolute left-0 top-[14px] h-8 w-8 rounded-full bg-background p-0 sm:left-4"
                onClick={resetConversation}
              >
                <PlusIcon className="h-3 w-3" />
                <span className="sr-only">New Chat</span>
              </Button>
              <Textarea
                placeholder="Send a message."
                className="min-h-[60px] w-full resize-none bg-transparent px-4 py-[1.3rem] outline-none sm:text-sm border-none focus-visible:ring-0 mx-4"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                name="message"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <div className="absolute right-0 top-[13px] sm:right-4">
                <Button size="icon" disabled={!input} onClick={sendMessage}>
                  <CornerDownLeft className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <p className="px-2 text-center text-xs leading-normal text-muted-foreground">
              Open-source AI chatbot built with ElevenLabs
            </p>
          </div>
        </div>
      </div>
      <audio ref={audioRef} hidden />
    </div>
  );
}

interface BotMessageComponentProps {
  messageId: string;
  words: string[];
  wordStartTimesMs: number[];
  currentTime: number;
  onWordClick: (messageId: string, startTime: number) => void;
  isPlaying: boolean;
  isClickable: boolean;
}

function BotMessageComponent({
  messageId,
  words,
  wordStartTimesMs,
  currentTime,
  onWordClick,
  isPlaying,
  isClickable,
}: BotMessageComponentProps) {
  const [hoveredWordIndex, setHoveredWordIndex] = useState<number | null>(null);

  return (
    <div>
      {words.map((word, index) => {
        const wordStartTime = wordStartTimesMs[index];
        const wordEndTime = wordStartTimesMs[index + 1] || Infinity;
        const isSpeaking = isPlaying && currentTime >= wordStartTime && currentTime < wordEndTime;
        const isHovered = index === hoveredWordIndex && isClickable;

        return (
          <span
            key={index}
            style={{
              backgroundColor: isSpeaking || isHovered ? "lightgreen" : "inherit",
              borderRadius: "4px",
              cursor: isClickable ? "pointer" : "default",
              transition: "background-color 0.3s",
            }}
            {...(isClickable && {
              onMouseEnter: () => setHoveredWordIndex(index),
              onMouseLeave: () => setHoveredWordIndex(null),
              onClick: () => onWordClick(messageId, wordStartTime),
            })}
          >
            {word + " "}
          </span>
        );
      })}
    </div>
  );
}
