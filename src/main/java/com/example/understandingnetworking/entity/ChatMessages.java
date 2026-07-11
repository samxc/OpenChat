package com.example.understandingnetworking.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ChatMessages {

    private String content;
    private String sender;
    private MessageType type;
    private String time;

    public enum MessageType {
        CHAT,
        CONNECT,
        DISCONNECT
    }

}
