package com.copalinks.monitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MonitoredGroupTest {
    @Test fun exactGroupInConversationTitleIsAccepted() {
        assertTrue(MonitoredGroup.matches("INFO. OP PORTO / FOSPAR **", null, "Fulano", true))
        assertTrue(MonitoredGroup.matches("  info.  op  porto / fospar **  ", null, "Fulano", null))
    }

    @Test fun groupInSubTextIsAcceptedWithoutReadingSender() {
        assertTrue(MonitoredGroup.matches(null, "INFO. OP PORTO / FOSPAR **", "Outro motorista", null))
    }

    @Test fun titleAloneRequiresExplicitGroupFlag() {
        assertTrue(MonitoredGroup.matches(null, null, "INFO. OP PORTO / FOSPAR **", true))
        assertTrue(MonitoredGroup.matches(null, null, "Maria @ INFO. OP PORTO / FOSPAR **", true))
        assertFalse(MonitoredGroup.matches(null, null, "INFO. OP PORTO / FOSPAR **", null))
        assertFalse(MonitoredGroup.matches(null, null, "Maria @ INFO. OP PORTO / FOSPAR **", null))
        assertFalse(MonitoredGroup.matches(null, null, "Maria @ INFO. OP PORTO / FOSPAR **", false))
    }

    @Test fun otherGroupsAndSimilarNamesNeverMatch() {
        assertFalse(MonitoredGroup.matches("INFO. OP PORTO / FOSPAR", null, null, true))
        assertFalse(MonitoredGroup.matches("INFO. OP PORTO / FOSPAR ** AVISOS", null, null, true))
        assertFalse(MonitoredGroup.matches("Outro grupo", "INFO. OP PORTO / FOSPAR **", null, true))
        assertFalse(MonitoredGroup.matches(null, "Outro grupo", "INFO. OP PORTO / FOSPAR **", null))
        assertFalse(MonitoredGroup.matches(null, null, null, null))
        assertFalse(MonitoredGroup.matches("INFO. OP PORTO / FOSPAR **", null, null, false))
    }

    @Test fun fingerprintMatchesServerConfiguration() {
        assertEquals("dd7790905a6cb38e7d5368c24e810ec1171af1153135300af46cc7b5225fe895", MonitoredGroup.fingerprint)
    }
}
