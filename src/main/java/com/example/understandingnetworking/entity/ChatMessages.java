package com.example.understandingnetworking.entity;

import lombok.*;

@Builder
public class ChatMessages {
    @Getter
    private String content;
    @Getter
    private String sender;
    @Getter
    private MessageType type;
    @Getter
    private String time;

    public enum MessageType{
        CHAT,
        CONNECT,
        DISCONNECT
    }

}
