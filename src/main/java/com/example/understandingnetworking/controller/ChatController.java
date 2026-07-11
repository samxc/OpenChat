package com.example.understandingnetworking.controller;

import com.example.understandingnetworking.chat.MessageHistory;
import com.example.understandingnetworking.entity.ChatMessages;
import com.example.understandingnetworking.security.RateLimiter;
import org.springframework.messaging.MessageHeaders;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Controller
public class ChatController {

    private static final int MAX_CONTENT = 2000;
    private static final int MAX_NAME = 40;
    private static final int MAX_FILENAME = 255;
    private static final int MAX_TYPE = 100;
    private static final int MAX_MAGNET = 4000;
    private static final int MAX_AVATAR = 50000; // small resized data-URL thumbnail
    private static final int MAX_ID = 64;
    private static final int MAX_EMOJI = 16;

    private final RateLimiter rateLimiter;
    private final MessageHistory history;
    private final SimpMessagingTemplate messagingTemplate;

    public ChatController(RateLimiter rateLimiter, MessageHistory history, SimpMessagingTemplate messagingTemplate) {
        this.rateLimiter = rateLimiter;
        this.history = history;
        this.messagingTemplate = messagingTemplate;
    }

    @MessageMapping("/chat.registerUser")
    @SendTo("/topic/public")
    public ChatMessages registerUser(@Payload ChatMessages incoming, SimpMessageHeaderAccessor headers) {
        String username = sanitize(incoming.getSender(), MAX_NAME);
        if (username == null || username.isBlank()) {
            return null;
        }
        String avatar = validAvatar(incoming.getAvatar());

        Map<String, Object> attrs = Objects.requireNonNull(headers.getSessionAttributes());
        attrs.put("username", username);
        attrs.put("avatar", avatar);

        // Catch this new session up on what it missed — sent privately, only to them.
        replayHistoryTo(headers.getSessionId());

        ChatMessages out = new ChatMessages();
        out.setType(ChatMessages.MessageType.CONNECT);
        out.setSender(username);
        out.setAvatar(avatar);
        return out;
    }

    @MessageMapping("/chat.send")
    @SendTo("/topic/public")
    public ChatMessages sendMessage(@Payload ChatMessages incoming, SimpMessageHeaderAccessor headers) {
        if (!rateLimiter.allow(headers.getSessionId())) {
            return null;
        }
        String sender = sessionUsername(headers);
        if (sender == null) {
            return null;
        }

        ChatMessages out = new ChatMessages();
        out.setSender(sender);
        out.setAvatar(sessionAvatar(headers));
        out.setTime(sanitize(incoming.getTime(), 20));

        ChatMessages.MessageType type = incoming.getType();

        if (type == ChatMessages.MessageType.REACTION) {
            String targetId = sanitize(incoming.getTargetId(), MAX_ID);
            String emoji = sanitize(incoming.getEmoji(), MAX_EMOJI);
            if (targetId == null || targetId.isBlank() || emoji == null || emoji.isBlank()) {
                return null;
            }
            out.setType(ChatMessages.MessageType.REACTION);
            out.setTargetId(targetId);
            out.setEmoji(emoji);
            history.add(out);
            return out;
        }

        if (type == ChatMessages.MessageType.FILE) {
            String magnet = incoming.getMagnetUri();
            if (magnet == null || !magnet.startsWith("magnet:") || magnet.length() > MAX_MAGNET) {
                return null;
            }
            out.setId(UUID.randomUUID().toString());
            out.setType(ChatMessages.MessageType.FILE);
            out.setMagnetUri(magnet);
            out.setFileName(sanitize(incoming.getFileName(), MAX_FILENAME));
            out.setFileType(sanitize(incoming.getFileType(), MAX_TYPE));
            out.setFileSize(incoming.getFileSize());
            out.setContent(sanitize(incoming.getContent(), MAX_CONTENT));
            history.add(out);
            return out;
        }

        String content = sanitize(incoming.getContent(), MAX_CONTENT);
        if (content == null || content.isBlank()) {
            return null;
        }
        out.setId(UUID.randomUUID().toString());
        out.setType(ChatMessages.MessageType.CHAT);
        out.setContent(content);
        history.add(out);
        return out;
    }

    /** Replay the buffered history to one specific session (a private "/user/queue/history" feed). */
    private void replayHistoryTo(String sessionId) {
        if (sessionId == null) {
            return;
        }
        for (ChatMessages past : history.snapshot()) {
            messagingTemplate.convertAndSendToUser(sessionId, "/queue/history", past, sessionHeaders(sessionId));
        }
    }

    private static MessageHeaders sessionHeaders(String sessionId) {
        SimpMessageHeaderAccessor accessor = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        accessor.setSessionId(sessionId);
        accessor.setLeaveMutable(true);
        return accessor.getMessageHeaders();
    }

    private String sessionUsername(SimpMessageHeaderAccessor headers) {
        Map<String, Object> attrs = headers.getSessionAttributes();
        return attrs == null ? null : (String) attrs.get("username");
    }

    private String sessionAvatar(SimpMessageHeaderAccessor headers) {
        Map<String, Object> attrs = headers.getSessionAttributes();
        return attrs == null ? null : (String) attrs.get("avatar");
    }

    private static String sanitize(String input, int maxLen) {
        if (input == null) {
            return null;
        }
        String trimmed = input.strip();
        return trimmed.length() > maxLen ? trimmed.substring(0, maxLen) : trimmed;
    }

    private static String validAvatar(String avatar) {
        if (avatar == null) {
            return null;
        }
        if (!avatar.startsWith("data:image/") || avatar.length() > MAX_AVATAR) {
            return null;
        }
        return avatar;
    }
}
