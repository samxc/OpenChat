package com.example.understandingnetworking.security;

import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A small sliding-window rate limiter, keyed by WebSocket session id. It stops a single
 * client from flooding the channel (spam / denial-of-service). Allows up to
 * MAX_MESSAGES within any WINDOW_MS window per session; extra messages are dropped.
 *
 * Note: session entries are not evicted here (fine for a small/demo deployment). A
 * production version would clear a session's entry on disconnect.
 */
@Component
public class RateLimiter {

    private static final int MAX_MESSAGES = 15;
    private static final long WINDOW_MS = 5_000;

    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    public boolean allow(String sessionId) {
        if (sessionId == null) {
            return true;
        }
        long now = System.currentTimeMillis();
        Deque<Long> times = hits.computeIfAbsent(sessionId, k -> new ArrayDeque<>());
        synchronized (times) {
            while (!times.isEmpty() && now - times.peekFirst() > WINDOW_MS) {
                times.pollFirst();
            }
            if (times.size() >= MAX_MESSAGES) {
                return false;
            }
            times.addLast(now);
            return true;
        }
    }
}
