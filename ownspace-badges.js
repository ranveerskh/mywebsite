/*
  OwnSpace shared inbox badge + chat read helper
  File name: ownspace-badges.js

  What this version fixes:
  - Inbox badge counts 1 unread chat THREAD, not every unread message.
  - Pending message requests still count normally.
  - Supports both badge styles used in your pages: .hidden and .show.
  - Opening a chat can mark that thread as read.
  - Reads chat_reads too, so cross-device read tracking works if that table exists.
  - Uses localStorage fallback so old messages do not stay stuck as unread on the same device.
  - Does not count old incoming messages if your latest message in that thread is outgoing.
  - Tries several Supabase column variants to survive schema differences during migration.
*/

const DEFAULT_BADGE_ID = "inboxBadge";
const READ_STORAGE_PREFIX = "ownspace_chat_read_at_";

function nowIso() {
  return new Date().toISOString();
}

function getField(raw, names, fallback = "") {
  for (const name of names) {
    const value = raw?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function getRaw(raw, names, fallback = null) {
  for (const name of names) {
    const value = raw?.[name];
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function toMillis(value) {
  if (!value) return 0;

  if (typeof value === "object" && typeof value.toDate === "function") {
    try {
      return value.toDate().getTime();
    } catch {}
  }

  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isMissingSchemaError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("schema cache") ||
    msg.includes("could not find") ||
    msg.includes("does not exist") ||
    msg.includes("relation") ||
    msg.includes("column")
  );
}

function formatBadgeCount(count) {
  return count > 99 ? "99+" : String(count);
}

function setBadgeValue(badgeEl, count) {
  if (!badgeEl) return;

  const n = Number(count || 0);

  if (!n) {
    badgeEl.textContent = "0";
    badgeEl.classList.add("hidden");
    badgeEl.classList.remove("show");
    badgeEl.setAttribute("aria-hidden", "true");
    return;
  }

  badgeEl.textContent = formatBadgeCount(n);
  badgeEl.classList.remove("hidden");
  badgeEl.classList.add("show");
  badgeEl.setAttribute("aria-hidden", "false");
}

function safeLocalReadKey(threadId) {
  return `${READ_STORAGE_PREFIX}${String(threadId || "").trim()}`;
}

function getLocalThreadReadMs(threadId) {
  if (!threadId) return 0;

  try {
    return Number(localStorage.getItem(safeLocalReadKey(threadId)) || 0) || 0;
  } catch {
    return 0;
  }
}

function setLocalThreadReadNow(threadId) {
  if (!threadId) return;

  try {
    localStorage.setItem(safeLocalReadKey(threadId), String(Date.now()));
  } catch {}
}

function signalBadgeRefresh() {
  try {
    localStorage.setItem("ownspace_badges_refresh", String(Date.now()));
    localStorage.setItem("ownspace_inbox_refresh", String(Date.now()));
    localStorage.setItem("ownspace_chat_read_refresh", String(Date.now()));
  } catch {}

  try {
    window.dispatchEvent(new CustomEvent("ownspace:badges-refresh"));
    window.dispatchEvent(new CustomEvent("ownspace:inbox-refresh"));
    window.dispatchEvent(new CustomEvent("ownspace:chat-read-refresh"));
  } catch {}
}

function getThreadId(row) {
  return getField(row, ["id", "thread_id", "threadId", "chat_thread_id", "chatThreadId"]);
}

function getMessageThreadId(row) {
  return getField(row, ["thread_id", "threadId", "chat_thread_id", "chatThreadId"]);
}

function getSenderId(row) {
  return getField(row, ["sender_id", "senderId", "from_user_id", "fromUserId", "user_id", "userId", "uid"]);
}

function getMessageCreatedAt(row) {
  return row?.created_at ?? row?.createdAt ?? row?.timestamp ?? row?.sent_at ?? row?.sentAt ?? null;
}

function arrayContainsUser(value, uid) {
  if (!value || !uid) return false;

  if (Array.isArray(value)) {
    return value.map(String).includes(String(uid));
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).includes(String(uid));
    } catch {}

    return value.split(",").map(v => v.trim()).includes(String(uid));
  }

  return false;
}

function messageLooksReadForUser(message, uid, readMs) {
  const createdMs = toMillis(getMessageCreatedAt(message));

  if (readMs && createdMs && readMs >= createdMs) return true;

  const readAt =
    message?.seen_at ??
    message?.read_at ??
    message?.seenAt ??
    message?.readAt ??
    message?.opened_at ??
    message?.openedAt ??
    null;

  if (readAt) return true;

  if (message?.is_read === true || message?.read === true || message?.seen === true) return true;
  if (message?.isRead === true || message?.hasRead === true || message?.has_seen === true || message?.hasSeen === true) return true;

  if (arrayContainsUser(message?.seen_by, uid)) return true;
  if (arrayContainsUser(message?.seenBy, uid)) return true;
  if (arrayContainsUser(message?.read_by, uid)) return true;
  if (arrayContainsUser(message?.readBy, uid)) return true;

  return false;
}

function getThreadParticipants(thread) {
  const ids = [
    thread?.participant_a,
    thread?.participant_b,
    thread?.participantA,
    thread?.participantB,
    thread?.user_a,
    thread?.user_b,
    thread?.userA,
    thread?.userB,
    thread?.member_a,
    thread?.member_b,
    thread?.memberA,
    thread?.memberB
  ]
    .filter(Boolean)
    .map(String);

  const participants =
    thread?.participants ||
    thread?.participant_ids ||
    thread?.participantIds ||
    thread?.members ||
    thread?.member_ids ||
    thread?.memberIds;

  if (Array.isArray(participants)) {
    participants.forEach(id => {
      if (id) ids.push(String(id));
    });
  }

  return [...new Set(ids)];
}

function threadIncludesUser(thread, uid) {
  if (!thread || !uid) return false;
  return getThreadParticipants(thread).includes(String(uid));
}

function threadIsActive(thread) {
  const status = normalizeText(getField(thread, ["status", "request_status", "requestStatus"], "accepted"));
  const hidden = !!(
    thread?.hidden ||
    thread?.hidden_by_admin ||
    thread?.hiddenByAdmin ||
    thread?.soft_deleted ||
    thread?.softDeleted ||
    thread?.deleted
  );

  if (hidden) return false;
  if (["blocked", "deleted", "hidden", "archived", "rejected", "declined"].includes(status)) return false;

  return true;
}

async function getCurrentUser(supabase) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

async function countRowsSafe(supabase, table, buildQuery) {
  try {
    const base = supabase.from(table).select("id", { count: "exact", head: true });
    const { count, error } = await buildQuery(base);
    if (!error) return count || 0;
  } catch {}
  return null;
}

async function countPendingMessageRequests(supabase, uid) {
  const targetColumns = [
    "target_id",
    "to_user_id",
    "receiver_id",
    "recipient_id",
    "targetId",
    "toUserId",
    "receiverId",
    "recipientId",
    "user_id",
    "userId"
  ];

  const statusColumns = ["status", "request_status", "requestStatus"];

  for (const targetColumn of targetColumns) {
    for (const statusColumn of statusColumns) {
      const count = await countRowsSafe(supabase, "message_requests", q =>
        q.eq(targetColumn, uid).eq(statusColumn, "pending")
      );

      if (count !== null) return count;
    }

    try {
      const { data, error } = await supabase
        .from("message_requests")
        .select("*")
        .eq(targetColumn, uid);

      if (!error && Array.isArray(data)) {
        return data.filter(row => {
          const status = normalizeText(getField(row, ["status", "request_status", "requestStatus"], "pending"));
          const hidden = !!(row?.hidden || row?.deleted || row?.soft_deleted || row?.softDeleted);
          return !hidden && status === "pending";
        }).length;
      }
    } catch {}
  }

  return 0;
}

async function loadUserThreads(supabase, uid) {
  const orAttempts = [
    `participant_a.eq.${uid},participant_b.eq.${uid}`,
    `participantA.eq.${uid},participantB.eq.${uid}`,
    `user_a.eq.${uid},user_b.eq.${uid}`,
    `userA.eq.${uid},userB.eq.${uid}`,
    `member_a.eq.${uid},member_b.eq.${uid}`,
    `memberA.eq.${uid},memberB.eq.${uid}`
  ];

  for (const orValue of orAttempts) {
    try {
      const { data, error } = await supabase
        .from("chat_threads")
        .select("*")
        .or(orValue);

      if (!error && Array.isArray(data)) {
        return data.filter(thread => getThreadId(thread) && threadIsActive(thread));
      }
    } catch {}
  }

  try {
    const { data, error } = await supabase
      .from("chat_threads")
      .select("*");

    if (!error && Array.isArray(data)) {
      return data.filter(thread => {
        return getThreadId(thread) && threadIsActive(thread) && threadIncludesUser(thread, uid);
      });
    }
  } catch {}

  return [];
}

async function loadLatestMessagesForThreads(supabase, threadIds) {
  if (!threadIds.length) return [];

  const threadColumns = ["thread_id", "threadId", "chat_thread_id", "chatThreadId"];
  const orderColumns = ["created_at", "createdAt", "sent_at", "sentAt", "timestamp"];

  for (const threadColumn of threadColumns) {
    for (const orderColumn of orderColumns) {
      try {
        const { data, error } = await supabase
          .from("chat_messages")
          .select("*")
          .in(threadColumn, threadIds)
          .order(orderColumn, { ascending: false })
          .limit(1000);

        if (!error && Array.isArray(data)) return data;
      } catch {}
    }
  }

  return [];
}

async function loadChatReadMap(supabase, uid) {
  const map = new Map();

  const attempts = [
    { user: "user_id", thread: "thread_id", read: "read_at" },
    { user: "userId", thread: "threadId", read: "readAt" },
    { user: "uid", thread: "thread_id", read: "read_at" },
    { user: "uid", thread: "threadId", read: "readAt" }
  ];

  for (const attempt of attempts) {
    try {
      const { data, error } = await supabase
        .from("chat_reads")
        .select("*")
        .eq(attempt.user, uid);

      if (!error && Array.isArray(data)) {
        data.forEach(row => {
          const threadId = getField(row, [attempt.thread, "thread_id", "threadId"]);
          const readAt = getRaw(row, [attempt.read, "read_at", "readAt", "updated_at", "updatedAt"], null);
          const readMs = toMillis(readAt);

          if (threadId && readMs) {
            map.set(String(threadId), Math.max(map.get(String(threadId)) || 0, readMs));
          }
        });

        return map;
      }
    } catch {}
  }

  return map;
}

function latestMessageByThread(messages) {
  const map = new Map();

  (messages || []).forEach(message => {
    const threadId = getMessageThreadId(message);
    if (!threadId) return;

    const existing = map.get(threadId);
    const currentMs = toMillis(getMessageCreatedAt(message));
    const existingMs = existing ? toMillis(getMessageCreatedAt(existing)) : 0;

    if (!existing || currentMs > existingMs) {
      map.set(threadId, message);
    }
  });

  return map;
}

export async function getOwnSpaceInboxBadgeCount(supabase, uid = "") {
  const user = uid ? { id: uid } : await getCurrentUser(supabase);
  if (!user?.id) return { total: 0, requests: 0, unreadThreads: 0 };

  const [requests, threads, chatReadMap] = await Promise.all([
    countPendingMessageRequests(supabase, user.id),
    loadUserThreads(supabase, user.id),
    loadChatReadMap(supabase, user.id)
  ]);

  const threadIds = threads.map(getThreadId).filter(Boolean);
  const messages = await loadLatestMessagesForThreads(supabase, threadIds);
  const latestMap = latestMessageByThread(messages);

  let unreadThreads = 0;

  threadIds.forEach(threadId => {
    const latestMessage = latestMap.get(threadId);
    if (!latestMessage) return;

    const senderId = getSenderId(latestMessage);
    if (!senderId || senderId === user.id) return;

    const localReadMs = getLocalThreadReadMs(threadId);
    const tableReadMs = chatReadMap.get(String(threadId)) || 0;
    const readMs = Math.max(localReadMs, tableReadMs);

    const isRead = messageLooksReadForUser(latestMessage, user.id, readMs);

    if (!isRead) unreadThreads += 1;
  });

  return {
    total: Number(requests || 0) + Number(unreadThreads || 0),
    requests: Number(requests || 0),
    unreadThreads: Number(unreadThreads || 0)
  };
}

export async function refreshOwnSpaceInboxBadge(supabase, options = {}) {
  const badgeId = options.badgeId || DEFAULT_BADGE_ID;
  const badgeEl = typeof badgeId === "string" ? document.getElementById(badgeId) : badgeId;

  if (!badgeEl) return { total: 0, requests: 0, unreadThreads: 0 };

  const user = options.user || await getCurrentUser(supabase);

  if (!user?.id) {
    setBadgeValue(badgeEl, 0);
    return { total: 0, requests: 0, unreadThreads: 0 };
  }

  const result = await getOwnSpaceInboxBadgeCount(supabase, user.id);
  setBadgeValue(badgeEl, result.total);
  return result;
}

export function initOwnSpaceInboxBadge(supabase, options = {}) {
  const refreshMs = Number(options.refreshMs || 12000);
  let timer = null;
  let channels = [];

  const refresh = () => {
    refreshOwnSpaceInboxBadge(supabase, options).catch(() => {});
  };

  const onFocus = () => refresh();
  const onVisibilityChange = () => {
    if (!document.hidden) refresh();
  };
  const onStorage = event => {
    if (
      event.key === "ownspace_badges_refresh" ||
      event.key === "ownspace_inbox_refresh" ||
      event.key === "ownspace_chat_read_refresh"
    ) {
      refresh();
    }
  };
  const onCustomRefresh = () => refresh();

  refresh();

  if (refreshMs > 0) {
    timer = setInterval(refresh, refreshMs);
  }

  ["message_requests", "chat_threads", "chat_messages", "chat_reads"].forEach(table => {
    try {
      const channel = supabase
        .channel(`ownspace-badge-${table}-${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          refresh
        )
        .subscribe();

      channels.push(channel);
    } catch {}
  });

  window.addEventListener("focus", onFocus);
  window.addEventListener("storage", onStorage);
  window.addEventListener("ownspace:badges-refresh", onCustomRefresh);
  window.addEventListener("ownspace:inbox-refresh", onCustomRefresh);
  window.addEventListener("ownspace:chat-read-refresh", onCustomRefresh);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    refresh,
    stop() {
      if (timer) clearInterval(timer);

      channels.forEach(channel => {
        try {
          supabase.removeChannel(channel);
        } catch {}
      });

      channels = [];

      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("ownspace:badges-refresh", onCustomRefresh);
      window.removeEventListener("ownspace:inbox-refresh", onCustomRefresh);
      window.removeEventListener("ownspace:chat-read-refresh", onCustomRefresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

async function updateIncomingMessagesRead(supabase, threadId, uid) {
  const timestamp = nowIso();

  const threadSenderCombos = [
    { thread: "thread_id", sender: "sender_id" },
    { thread: "threadId", sender: "senderId" },
    { thread: "chat_thread_id", sender: "sender_id" },
    { thread: "chatThreadId", sender: "senderId" }
  ];

  const payloads = [
    { seen_at: timestamp, read_at: timestamp, is_read: true, read: true, updated_at: timestamp },
    { seen_at: timestamp, read_at: timestamp, updated_at: timestamp },
    { seen_at: timestamp, updated_at: timestamp },
    { read_at: timestamp, updated_at: timestamp },
    { is_read: true, updated_at: timestamp },
    { read: true, updated_at: timestamp },
    { seenAt: timestamp, readAt: timestamp, isRead: true, updatedAt: timestamp },
    { seenAt: timestamp, updatedAt: timestamp },
    { readAt: timestamp, updatedAt: timestamp },
    { isRead: true, updatedAt: timestamp }
  ];

  let worked = false;

  for (const combo of threadSenderCombos) {
    for (const payload of payloads) {
      try {
        const { error } = await supabase
          .from("chat_messages")
          .update(payload)
          .eq(combo.thread, threadId)
          .neq(combo.sender, uid);

        if (!error) worked = true;
        else if (!isMissingSchemaError(error)) console.warn("mark read message update failed:", error.message);
      } catch {}
    }
  }

  return worked;
}

async function updateChatReadRow(supabase, threadId, uid) {
  const timestamp = nowIso();

  const payloads = [
    {
      thread_id: threadId,
      user_id: uid,
      read_at: timestamp,
      updated_at: timestamp
    },
    {
      threadId: threadId,
      userId: uid,
      readAt: timestamp,
      updatedAt: timestamp
    }
  ];

  for (const payload of payloads) {
    try {
      const snake = Object.prototype.hasOwnProperty.call(payload, "thread_id");

      const { error } = await supabase
        .from("chat_reads")
        .upsert(payload, {
          onConflict: snake ? "thread_id,user_id" : "threadId,userId"
        });

      if (!error) return true;
    } catch {}
  }

  return false;
}

async function updateThreadReadState(supabase, threadId, uid) {
  const timestamp = nowIso();

  let thread = null;

  try {
    const { data } = await supabase
      .from("chat_threads")
      .select("*")
      .eq("id", threadId)
      .maybeSingle();

    thread = data || null;
  } catch {}

  const isA =
    thread?.participant_a === uid ||
    thread?.participantA === uid ||
    thread?.user_a === uid ||
    thread?.userA === uid ||
    thread?.member_a === uid ||
    thread?.memberA === uid;

  const isB =
    thread?.participant_b === uid ||
    thread?.participantB === uid ||
    thread?.user_b === uid ||
    thread?.userB === uid ||
    thread?.member_b === uid ||
    thread?.memberB === uid;

  const payloads = [];

  if (isA) {
    payloads.push({ participant_a_read_at: timestamp, participant_a_unread_count: 0, updated_at: timestamp });
    payloads.push({ participantAReadAt: timestamp, participantAUnreadCount: 0, updatedAt: timestamp });
    payloads.push({ user_a_read_at: timestamp, user_a_unread_count: 0, updated_at: timestamp });
    payloads.push({ userAReadAt: timestamp, userAUnreadCount: 0, updatedAt: timestamp });
  }

  if (isB) {
    payloads.push({ participant_b_read_at: timestamp, participant_b_unread_count: 0, updated_at: timestamp });
    payloads.push({ participantBReadAt: timestamp, participantBUnreadCount: 0, updatedAt: timestamp });
    payloads.push({ user_b_read_at: timestamp, user_b_unread_count: 0, updated_at: timestamp });
    payloads.push({ userBReadAt: timestamp, userBUnreadCount: 0, updatedAt: timestamp });
  }

  payloads.push({ updated_at: timestamp });
  payloads.push({ updatedAt: timestamp });

  let worked = false;

  for (const payload of payloads) {
    try {
      const { error } = await supabase
        .from("chat_threads")
        .update(payload)
        .eq("id", threadId);

      if (!error) worked = true;
    } catch {}
  }

  return worked;
}

export async function markOwnSpaceThreadRead(supabase, threadId, uid = "") {
  const user = uid ? { id: uid } : await getCurrentUser(supabase);
  if (!user?.id || !threadId) return false;

  setLocalThreadReadNow(threadId);

  const results = await Promise.allSettled([
    updateIncomingMessagesRead(supabase, threadId, user.id),
    updateChatReadRow(supabase, threadId, user.id),
    updateThreadReadState(supabase, threadId, user.id)
  ]);

  signalBadgeRefresh();

  return results.some(r => r.status === "fulfilled" && r.value);
}

/*
  Simple usage in pages:

  import { supabase } from "./supabase.js";
  import { initOwnSpaceInboxBadge, markOwnSpaceThreadRead } from "./ownspace-badges.js";

  const badgeController = initOwnSpaceInboxBadge(supabase);

  // In chat.html after you know threadId:
  await markOwnSpaceThreadRead(supabase, threadId);

  // Optional cleanup before leaving page:
  window.addEventListener("beforeunload", () => badgeController.stop());
*/
