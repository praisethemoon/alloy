import java.io.File;

import edu.mit.csail.sdg.alloy4viz.AlloyInstance;
import edu.mit.csail.sdg.alloy4viz.StaticInstanceReader;
import edu.mit.csail.sdg.alloy4viz.StaticThemeReaderWriter;
import edu.mit.csail.sdg.alloy4viz.VizState;

/**
 * Test helper: loads a theme with the Alloy app's own reader, for an instance,
 * and writes it back with the app's writer. If the app can't read the theme,
 * this fails; comparing its rewrite with the original shows what it understood.
 * Usage: ThemeCheck instance.xml theme.thm rewritten.thm
 */
public final class ThemeCheck {
    public static void main(String[] args) throws Exception {
        AlloyInstance instance = StaticInstanceReader.parseInstance(new File(args[0]), 0);
        VizState state = new VizState(instance);
        StaticThemeReaderWriter.readAlloy(args[1], state);
        StaticThemeReaderWriter.writeAlloy(args[2], state);
    }
}
