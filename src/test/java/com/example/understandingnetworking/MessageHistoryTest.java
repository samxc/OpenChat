package com.example.understandingnetworking;

import com.example.understandingnetworking.chat.MessageHistory;
import com.example.understandingnetworking.entity.ChatMessages;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class MessageHistoryTest {

    @Test
    void keepsOnlyTheMostRecentMessages() {
        MessageHistory history = new MessageHistory();
        for (int i = 0; i < 150; i++) {
            history.add(ChatMessages.builder().content("m" + i).type(ChatMessages.MessageType.CHAT).build());
        }

        List<ChatMessages> snapshot = history.snapshot();
        assertEquals(100, snapshot.size(), "buffer must cap at 100");
        // The oldest 50 (m0..m49) were evicted; the window is m50..m149.
        assertEquals("m50", snapshot.get(0).getContent());
        assertEquals("m149", snapshot.get(99).getContent());
    }
}
