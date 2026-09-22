package com.psyclefinder.app.tips;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class PsyncTipsTest {

    @Test
    public void threeTipsCheapestFirst() {
        assertEquals(Arrays.asList(
            "com.psyclefinder.app.tip.small",
            "com.psyclefinder.app.tip.medium",
            "com.psyclefinder.app.tip.large"), PsyncTips.IDS);
    }

    @Test(expected = UnsupportedOperationException.class)
    public void theListCannotBeChanged() {
        PsyncTips.IDS.add("com.psyclefinder.app.tip.huge");
    }

    @Test
    public void onlyTheThreeAreTips() {
        assertTrue(PsyncTips.isTip("com.psyclefinder.app.tip.medium"));
        assertFalse(PsyncTips.isTip(null));
        assertFalse(PsyncTips.isTip(""));
        assertFalse(PsyncTips.isTip("com.psyclefinder.app.tip.small "));
        assertFalse(PsyncTips.isTip("COM.PSYCLEFINDER.APP.TIP.SMALL"));
        assertFalse(PsyncTips.isTip("com.psyclefinder.app.pro"));
        assertFalse(PsyncTips.isTip("android.test.purchased"));
    }

    @Test
    public void aPurchaseIsOursOnlyWhenEveryProductIsATip() {
        assertTrue(PsyncTips.allTips(Collections.singletonList("com.psyclefinder.app.tip.large")));
        assertTrue(PsyncTips.allTips(Arrays.asList("com.psyclefinder.app.tip.small", "com.psyclefinder.app.tip.large")));
        assertFalse(PsyncTips.allTips(Arrays.asList("com.psyclefinder.app.tip.small", "something.else")));
        assertFalse(PsyncTips.allTips(Collections.<String>emptyList()));
        assertFalse(PsyncTips.allTips(null));
        assertFalse(PsyncTips.allTips(Collections.<String>singletonList(null)));
    }
}
