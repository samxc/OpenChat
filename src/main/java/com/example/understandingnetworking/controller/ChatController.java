package com.example.understandingnetworking.controller;

import com.example.understandingnetworking.entity.ChatMessages;
import com.example.understandingnetworking.security.RateLimiter;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.stereotype.Controller;

import java.util.Map;
import java.util.Objects;

@Controller
public class ChatController {

    private static final int MAX_CONTENT = 2000;
    private static final int MAX_NAME = 40;
    private static final int MAX_FILENAME = 255;
    private static final int MAX_TYPE = 100;
    private static final int MAX_MAGNET = 4000;

    private final RateLimiter rateLimiter;

    public ChatController(RateLimiter rateLimiter) {
        this.rateLimiter = rateLimiter;
    }

    @MessageMapping("/chat.registerUser")
    @SendTo("/topic/public")
    public ChatMessages registerUser(@Payload ChatMessages incoming, SimpMessageHeaderAccessor headers) {
        String username = sanitize(incoming.getSender(), MAX_NAME);
        if (username == null || username.isBlank()) {
            return null; // reject nameless registrations — nothing is broadcast
        }
        // Remember the name on the session; every later message uses THIS, not the payload.
        Objects.requireNonNull(headers.getSessionAttributes()).put("username", username);

        ChatMessages out = new ChatMessages();
        out.setType(ChatMessages.MessageType.CONNECT);
        out.setSender(username);
        return out;
    }

    @MessageMapping("/chat.send")
    @SendTo("/topic/public")
    public ChatMessages sendMessage(@Payload ChatMessages incoming, SimpMessageHeaderAccessor headers) {
        // 1) Flood protection.
        if (!rateLimiter.allow(headers.getSessionId())) {
            return null;
        }

        // 2) Identity is taken from the session, NOT the client payload. This stops a
        //    connected user from spoofing someone else's name on a per-message basis.
        String sender = sessionUsername(headers);
        if (sender == null) {
            return null; // not registered → ignore
        }

        // 3) Rebuild the outgoing message from scratch so the client can only influence
        //    fields we explicitly copy and validate — never anything else.
        ChatMessages out = new ChatMessages();
        out.setSender(sender);
        out.setTime(sanitize(incoming.getTime(), 20));

        if (incoming.getType() == ChatMessages.MessageType.FILE) {
            String magnet = incoming.getMagnetUri();
            if (magnet == null || !magnet.startsWith("magnet:") || magnet.length() > MAX_MAGNET) {
                return null; // a FILE message must carry a valid magnet link
            }
            out.setType(ChatMessages.MessageType.FILE);
            out.setMagnetUri(magnet);
            out.setFileName(sanitize(incoming.getFileName(), MAX_FILENAME));
            out.setFileType(sanitize(incoming.getFileType(), MAX_TYPE));
            out.setFileSize(incoming.getFileSize());
            out.setContent(sanitize(incoming.getContent(), MAX_CONTENT));
        } else {
            String content = sanitize(incoming.getContent(), MAX_CONTENT);
            if (content == null || content.isBlank()) {
                return null; // no empty chat messages
            }
            out.setType(ChatMessages.MessageType.CHAT);
            out.setContent(content);
        }
        return out;
    }

    private String sessionUsername(SimpMessageHeaderAccessor headers) {
        Map<String, Object> attrs = headers.getSessionAttributes();
        return attrs == null ? null : (String) attrs.get("username");
    }

    /** Trim, and hard-cap the length so no field can be abused to bloat a message. */
    private static String sanitize(String input, int maxLen) {
        if (input == null) {
            return null;
        }
        String trimmed = input.strip();
        return trimmed.length() > maxLen ? trimmed.substring(0, maxLen) : trimmed;
    }
}
