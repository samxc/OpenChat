package com.example.understandingnetworking;

import com.example.understandingnetworking.entity.ChatMessages;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.springframework.web.socket.sockjs.client.SockJsClient;
import org.springframework.web.socket.sockjs.client.Transport;
import org.springframework.web.socket.sockjs.client.WebSocketTransport;

import java.lang.reflect.Type;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static java.util.Collections.singletonList;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * End-to-end test over a real WebSocket/STOMP connection. It now reflects the hardened
 * flow: a client must first register (so the server knows its identity from the session),
 * and the server stamps the sender itself — so the broadcast sender comes from the
 * session, not from the client payload.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ChatRoundTripTest {

    @LocalServerPort
    private int port;

    @Test
    void registeredUserMessageIsBroadcastWithServerStampedSender() throws Exception {
        List<Transport> transports = singletonList(new WebSocketTransport(new StandardWebSocketClient()));
        WebSocketStompClient stompClient = new WebSocketStompClient(new SockJsClient(transports));
        stompClient.setMessageConverter(new JacksonJsonMessageConverter());

        StompSession session = stompClient
                .connectAsync("ws://localhost:" + port + "/chatPoint", new StompSessionHandlerAdapter() {})
                .get(5, TimeUnit.SECONDS);

        BlockingQueue<ChatMessages> received = new LinkedBlockingQueue<>();
        session.subscribe("/topic/public", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return ChatMessages.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                received.add((ChatMessages) payload);
            }
        });

        // 1) Register — the server stores "alice" on the session and broadcasts a CONNECT.
        session.send("/app/chat.registerUser", ChatMessages.builder()
                .sender("alice")
                .type(ChatMessages.MessageType.CONNECT)
                .build());

        // Wait for the CONNECT so we know registration was processed before sending a chat.
        assertNotNull(awaitType(received, ChatMessages.MessageType.CONNECT),
                "expected a CONNECT broadcast after registering");

        // 2) Send a chat with a deliberately WRONG sender — the server must ignore it.
        session.send("/app/chat.send", ChatMessages.builder()
                .sender("i-am-an-impostor")
                .content("hello world")
                .type(ChatMessages.MessageType.CHAT)
                .time("now")
                .build());

        ChatMessages chat = awaitType(received, ChatMessages.MessageType.CHAT);
        assertNotNull(chat, "expected the chat message to be broadcast");
        assertEquals("hello world", chat.getContent());
        assertEquals("alice", chat.getSender(), "server must stamp the session's name, not the payload's");
    }

    /** Poll the queue until a message of the given type arrives (or time out). */
    private ChatMessages awaitType(BlockingQueue<ChatMessages> queue, ChatMessages.MessageType type)
            throws InterruptedException {
        long deadline = System.currentTimeMillis() + 5000;
        long remaining;
        while ((remaining = deadline - System.currentTimeMillis()) > 0) {
            ChatMessages msg = queue.poll(remaining, TimeUnit.MILLISECONDS);
            if (msg != null && msg.getType() == type) {
                return msg;
            }
        }
        return null;
    }
}
