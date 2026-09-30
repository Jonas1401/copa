package com.copalinks.monitor

import org.junit.Assert.assertEquals
import org.junit.Test

class CodeMatcherTest {
    @Test fun matchesExactlyCodesAndDeduplicates() {
        assertEquals(listOf("A184", "B22", "M69"), CodeMatcher.extract("A184, A 184 e B-022. M069"))
    }
    @Test fun ignoresNumbersAndLongerWords() {
        assertEquals(emptyList<String>(), CodeMatcher.extract("A1840 ABC184 2024 4191994041 grupoB184"))
    }
    @Test fun invalidZeroIsIgnored() {
        assertEquals(emptyList<String>(), CodeMatcher.extract("A000 B0 M-000"))
    }
}
