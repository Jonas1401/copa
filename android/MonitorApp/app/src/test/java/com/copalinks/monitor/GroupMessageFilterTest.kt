package com.copalinks.monitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GroupMessageFilterTest {
    @Test fun forwardsOnlyTheTwoLists() {
        assertTrue(GroupMessageFilter.shouldForward("PONTOS NA VEZ\n\nCARRETAS TRUCADAS (A):\nA014 - A016"))
        assertTrue(GroupMessageFilter.shouldForward("TRUCADAS PULADAS:\nA137 - A140"))
        assertTrue(GroupMessageFilter.shouldForward("*Pontos na vez*: A014"))
    }

    @Test fun ordinaryGroupChatStaysOnThePhone() {
        assertFalse(GroupMessageFilter.shouldForward("Bom dia! A014 favor ir à balança."))
        assertFalse(GroupMessageFilter.shouldForward(""))
        assertFalse(GroupMessageFilter.shouldForward(null))
    }

    @Test fun sameMessageSameEventId() {
        val a = GroupMessageFilter.eventId("k1", 10L, "PONTOS NA VEZ A014")
        assertEquals(a, GroupMessageFilter.eventId("k1", 10L, "PONTOS NA VEZ A014"))
        assertNotEquals(a, GroupMessageFilter.eventId("k1", 11L, "PONTOS NA VEZ A014"))
        assertEquals(64, a.length)
    }
}
