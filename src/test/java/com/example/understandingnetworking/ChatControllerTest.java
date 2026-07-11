package com.example.understandingnetworking;

import com.example.understandingnetworking.chat.MessageHistory;
import com.example.understandingnetworking.controller.ChatController;
import com.example.understandingnetworking.entity.ChatMessages;
import com.example.understandingnetworking.security.RateLimiter;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;

/**
 * Fast, deterministic unit tests for the chat controller — no network, no timing.
 * The messaging template (used for private history replay) is a mock.
 */
class ChatControllerTest {

    private final MessageHistory history = new MessageHistory();

    private ChatController controller() {
        return new ChatController(new RateLimiter(), history, mock(SimpMessagingTemplate.class));
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
                .sender("i-am-an-impostor")
                .content("hello world")
                .type(ChatMessages.MessageType.CHAT)
                .build();

        ChatMessages out = controller().sendMessage(incoming, headers);

        assertNotNull(out);
        assertEquals("hello world", out.getContent());
        assertEquals("alice", out.getSender(), "server must use the session's name, not the payload's");
    }

    @Test
    void reactionIsRelayedWithSessionSender() {
        SimpMessageHeaderAccessor headers = session("s1", "alice");
        ChatMessages incoming = ChatMessages.builder()
                .type(ChatMessages.MessageType.REACTION)
                .targetId("msg-123")
                .emoji("👍")
                .sender("impostor")
                .build();

        ChatMessages out = controller().sendMessage(incoming, headers);

        assertNotNull(out);
        assertEquals(ChatMessages.MessageType.REACTION, out.getType());
        assertEquals("msg-123", out.getTargetId());
        assertEquals("👍", out.getEmoji());
        assertEquals("alice", out.getSender());
    }

    @Test
    void replyIsRelayedWithParentAndSessionSender() {
        SimpMessageHeaderAccessor headers = session("s1", "alice");
        ChatMessages incoming = ChatMessages.builder()
                .type(ChatMessages.MessageType.REPLY)
                .targetId("parent-1")
                .content("great point!")
                .sender("impostor")
                .build();

        ChatMessages out = controller().sendMessage(incoming, headers);

        assertNotNull(out);
        assertEquals(ChatMessages.MessageType.REPLY, out.getType());
        assertEquals("parent-1", out.getTargetId());
        assertEquals("great point!", out.getContent());
        assertEquals("alice", out.getSender());
        assertNotNull(out.getId(), "a reply gets its own id");
    }

    @Test
    void chatMessagesAreRecordedInHistory() {
        SimpMessageHeaderAccessor headers = session("s1", "alice");
        ChatController controller = controller();

        controller.sendMessage(ChatMessages.builder().content("first").type(ChatMessages.MessageType.CHAT).build(), headers);
        controller.sendMessage(ChatMessages.builder().content("second").type(ChatMessages.MessageType.CHAT).build(), headers);

        assertEquals(2, history.size());
        assertEquals("first", history.snapshot().get(0).getContent());
        assertEquals("second", history.snapshot().get(1).getContent());
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
