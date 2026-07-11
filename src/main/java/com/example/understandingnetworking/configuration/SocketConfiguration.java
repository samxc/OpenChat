package com.example.understandingnetworking.configuration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;

@Configuration
@EnableWebSocketMessageBroker
public class SocketConfiguration implements WebSocketMessageBrokerConfigurer {

    /**
     * Which web origins may open a socket to this server. Locking this down stops a
     * malicious website from opening a WebSocket to our server on a visitor's behalf
     * (cross-site WebSocket hijacking). Defaults to localhost for development — add your
     * real domain in production via the openchat.allowed-origins property.
     */
    @Value("${openchat.allowed-origins:http://localhost:*,https://localhost:*}")
    private String[] allowedOrigins;

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/chatPoint")
                .setAllowedOriginPatterns(allowedOrigins)
                .withSockJS();
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic");
        registry.setApplicationDestinationPrefixes("/app");
    }

    /**
     * Caps on the WebSocket transport so a single client can't exhaust server memory
     * with an enormous message. Our real messages (text + magnet links) are tiny, so
     * 64 KB is generous headroom.
     */
    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        registration.setMessageSizeLimit(64 * 1024);        // max inbound message: 64 KB
        registration.setSendBufferSizeLimit(512 * 1024);    // max buffered outbound per session
        registration.setSendTimeLimit(20 * 1000);           // drop slow/stuck clients after 20s
    }
}
