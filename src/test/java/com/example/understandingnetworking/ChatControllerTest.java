package com.example.understandingnetworking;

import com.example.understandingnetworking.controller.ChatController;
import com.example.understandingnetworking.entity.ChatMessages;
import com.example.understandingnetworking.security.RateLimiter;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Fast, deterministic unit tests for the chat controller. These replace an earlier
 * end-to-end WebSocket test that was flaky on CI (a subscribe/broadcast timing race):
 * here we call the controller directly with a stubbed session — no network, no timing.
 */
class ChatControllerTest {

    private ChatController controller() {
        return new ChatController(new RateLimiter());
    }

    private SimpMessageHeaderAccessor session(String sessionId, String username) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create();
        headers.setSessionId(sessionId);
        Map<String, Object> attrs = new HashMap<>();
        if (username != null) {
            attrs.put("username", username);
        }
        headers.setSessionAttributes(attrs);
        return headers;
    }

    @Test
    void registerUserBroadcastsConnectWithSanitizedName() {
        SimpMessageHeaderAccessor headers = session("s1", null);
        ChatMessages incoming = ChatMessages.builder()
                .sender("  Alice  ")
                .type(ChatMessages.MessageType.CONNECT)
                .build();

        ChatMessages out = controller().registerUser(incoming, headers);

        assertNotNull(out);
        assertEquals(ChatMessages.MessageType.CONNECT, out.getType());
        assertEquals("Alice", out.getSender());
        assertEquals("Alice", headers.getSessionAttributes().get("username"));
    }

    @Test
    void sendMessageStampsSenderFromSessionNotFromPayload() {
        SimpMessageHeaderAccessor headers = session("s1", "alice");
        ChatMessages incoming = ChatMessages.builder()
                .sender("i-am-an-impostor")   // the server must ignore this
                .content("hello world")
                .type(ChatMessages.MessageType.CHAT)
                .build();

        ChatMessages out = controller().sendMessage(incoming, headers);

        assertNotNull(out);
        assertEquals("hello world", out.getContent());
        assertEquals("alice", out.getSender(), "server must use the session's name, not the payload's");
    }

    @Test
    void sendMessageIsIgnoredWhenNotRegistered() {
        SimpMessageHeaderAccessor headers = session("s1", null); // no username on the session
        ChatMessages incoming = ChatMessages.builder()
                .content("hello")
                .type(ChatMessages.MessageType.CHAT)
                .build();

        assertNull(controller().sendMessage(incoming, headers), "unregistered senders must be ignored");
    }
}
