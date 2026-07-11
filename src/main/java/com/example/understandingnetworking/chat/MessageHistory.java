package com.example.understandingnetworking.chat;

import com.example.understandingnetworking.entity.ChatMessages;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * A small, in-memory ring buffer of recent broadcast messages (chat, files, reactions).
 * When someone joins, the server replays this to them so they're caught up — no one has
 * to re-send anything. It holds only the lightweight message stream (text + magnet links),
 * never file bytes, and it's ephemeral: cleared on restart. Not a database.
 */
@Component
public class MessageHistory {

    private static final int MAX_MESSAGES = 100;

    private final Deque<ChatMessages> buffer = new ArrayDeque<>();

    public synchronized void add(ChatMessages message) {
        buffer.addLast(message);
        while (buffer.size() > MAX_MESSAGES) {
            buffer.pollFirst();
        }
    }

    /** A point-in-time copy of the buffered messages, oldest first. */
    public synchronized List<ChatMessages> snapshot() {
        return new ArrayList<>(buffer);
    }

    public synchronized int size() {
        return buffer.size();
    }
}
