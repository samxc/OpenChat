package com.example.understandingnetworking.controller;

import com.example.understandingnetworking.entity.ChatMessages;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.stereotype.Controller;

import java.util.Objects;

@Controller
public class ChatController {
    @MessageMapping("/chat.registerUser")
    @SendTo("/topic/public")
    public ChatMessages registerUser(@Payload final ChatMessages chatMessages, SimpMessageHeaderAccessor simpMessageHeaderAccessor){
        Objects.requireNonNull(simpMessageHeaderAccessor.getSessionAttributes()).put("username", chatMessages.getSender());
        return chatMessages;
    }

    @MessageMapping("/chat.send")
    @SendTo("/topic/public")
    public ChatMessages sendMessage(@Payload final ChatMessages chatMessages){
        return chatMessages;
    }
}
