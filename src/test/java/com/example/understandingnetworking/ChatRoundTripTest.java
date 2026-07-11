package com.example.understandingnetworking;

import com.example.understandingnetworking.entity.ChatMessages;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
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
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static java.util.Collections.singletonList;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Full end-to-end test: opens a real WebSocket/STOMP connection to the running app,
 * subscribes to the public topic, sends a chat message, and asserts it is broadcast
 * back. This exercises the exact JSON (de)serialization path that was broken before
 * the ChatMessages fix.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ChatRoundTripTest {

    @LocalServerPort
    private int port;

    @Test
    void messageSentIsBroadcastBack() throws Exception {
        List<Transport> transports = singletonList(new WebSocketTransport(new StandardWebSocketClient()));
        WebSocketStompClient stompClient = new WebSocketStompClient(new SockJsClient(transports));
        stompClient.setMessageConverter(new MappingJackson2MessageConverter());

        StompSession session = stompClient
                .connectAsync("ws://localhost:" + port + "/chatPoint", new StompSessionHandlerAdapter() {})
                .get(5, TimeUnit.SECONDS);

        CompletableFuture<ChatMessages> received = new CompletableFuture<>();
        session.subscribe("/topic/public", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return ChatMessages.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                received.complete((ChatMessages) payload);
            }
        });

        ChatMessages outgoing = ChatMessages.builder()
                .sender("alice")
                .content("hello world")
                .type(ChatMessages.MessageType.CHAT)
                .time("now")
                .build();
        session.send("/app/chat.send", outgoing);

        ChatMessages result = received.get(5, TimeUnit.SECONDS);
        assertEquals("alice", result.getSender());
        assertEquals("hello world", result.getContent());
        assertEquals(ChatMessages.MessageType.CHAT, result.getType());
    }
}
