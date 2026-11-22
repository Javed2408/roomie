import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { SrmMark } from "@/components/ui/srm-badge";
import { lookingFor } from "@/lib/likes";
import { timeAgo } from "@/lib/time";
import { firstName } from "@/types/feed";
import type { Conversation } from "@/types/matches";

/** What the row says under the name: the latest message, or how it began. */
function Preview({ conversation, myId }: { conversation: Conversation; myId: string }) {
  const { lastMessage, initialComment } = conversation;
  if (lastMessage) {
    const mine = lastMessage.sender_id === myId;
    return (
      <p
        className={`truncate text-sm ${mine ? "text-muted" : "text-charcoal font-medium"}`}
      >
        {mine && "You: "}
        {lastMessage.content}
      </p>
    );
  }
  if (initialComment) {
    return <p className="text-muted truncate text-sm italic">“{initialComment}”</p>;
  }
  return <p className="text-accent-strong truncate text-sm font-medium">New match. Say hi!</p>;
}

/** Everyone you've matched with, the most recent conversation first. */
export function ConversationList({
  conversations,
  myId,
}: {
  conversations: Conversation[];
  myId: string;
}) {
  return (
    <ul className="bg-surface border-line rounded-card divide-line divide-y overflow-hidden border">
      {conversations.map((conversation) => {
        const name = firstName(conversation.profile);
        const { lastMessage } = conversation;
        const status = !lastMessage
          ? "New"
          : lastMessage.sender_id !== myId
            ? "Your turn"
            : null;
        const hasFlat = Boolean(conversation.listing);
        return (
          <li key={conversation.matchId}>
            <Link
              href={`/matches/${conversation.matchId}`}
              className="hover:bg-charcoal/[0.03] focus-visible:outline-accent flex items-center gap-3 px-4 py-3.5 focus-visible:outline-2 focus-visible:-outline-offset-2"
            >
              <Avatar
                url={conversation.profile.avatar_url}
                name={name}
                className="size-14 rounded-full text-xl"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-semibold">{name}</p>
                  {conversation.profile.is_srm_verified && <SrmMark />}
                  <time
                    dateTime={conversation.activityAt}
                    className="text-muted ml-auto shrink-0 pl-2 text-xs"
                  >
                    {timeAgo(conversation.activityAt)}
                  </time>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span
                    className={`truncate rounded-full px-2 py-0.5 text-xs font-medium ${
                      hasFlat ? "bg-forest-soft text-forest" : "bg-charcoal/5 text-muted"
                    }`}
                  >
                    {lookingFor(conversation)}
                  </span>
                  {status && (
                    <span className="bg-accent-soft text-accent-strong ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">
                      {status}
                    </span>
                  )}
                </div>
                <div className="mt-1">
                  <Preview conversation={conversation} myId={myId} />
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
