package io.github.zetsuu123.voidicons;

import android.app.Activity;
import android.content.Intent;
import android.content.res.XmlResourceParser;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/** Shows the icons and how to apply them with Theme Park. Launchers only read the resources. */
public class MainActivity extends Activity {
    private static final int BG = 0xFF04030A, TEXT = 0xFFE2E0FF, MUTED = 0xFF8D8BB8, ACCENT = 0xFF7B61FF;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        float dp = getResources().getDisplayMetrics().density;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        int pad = (int) (20 * dp);
        root.setPadding(pad, (int) (36 * dp), pad, (int) (28 * dp));

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextColor(TEXT);
        title.setTextSize(26);
        root.addView(title);

        TextView how = new TextView(this);
        how.setText(R.string.how_to);
        how.setTextColor(MUTED);
        how.setTextSize(14);
        how.setPadding(0, (int) (8 * dp), 0, (int) (14 * dp));
        root.addView(how);

        Button open = new Button(this);
        open.setText(R.string.open_theme_park);
        open.setTextColor(Color.WHITE);
        open.setAllCaps(false);
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(ACCENT);
        pill.setCornerRadius(24 * dp);
        open.setBackground(pill);
        open.setOnClickListener(v -> openThemePark());
        root.addView(open, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (int) (48 * dp)));

        List<Integer> icons = loadIcons();
        GridView grid = new GridView(this);
        grid.setNumColumns(4);
        grid.setVerticalSpacing((int) (12 * dp));
        grid.setPadding(0, (int) (18 * dp), 0, (int) (18 * dp));
        grid.setClipToPadding(false);
        int cell = (int) (68 * dp);
        grid.setAdapter(new BaseAdapter() {
            public int getCount() { return icons.size(); }
            public Object getItem(int i) { return icons.get(i); }
            public long getItemId(int i) { return i; }
            public View getView(int i, View old, ViewGroup parent) {
                ImageView iv = old instanceof ImageView ? (ImageView) old : new ImageView(MainActivity.this);
                iv.setLayoutParams(new GridView.LayoutParams(cell, cell));
                iv.setImageResource(icons.get(i));
                return iv;
            }
        });
        grid.setGravity(Gravity.CENTER);
        root.addView(grid, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private List<Integer> loadIcons() {
        List<Integer> out = new ArrayList<>();
        try (XmlResourceParser p = getResources().getXml(R.xml.drawable)) {
            for (int e = p.getEventType(); e != XmlResourceParser.END_DOCUMENT; e = p.next()) {
                if (e == XmlResourceParser.START_TAG && "item".equals(p.getName())) {
                    int id = getResources().getIdentifier(p.getAttributeValue(null, "drawable"), "drawable", getPackageName());
                    if (id != 0) out.add(id);
                }
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    private void openThemePark() {
        for (String pkg : new String[]{"com.samsung.android.themedesigner", "com.samsung.android.goodlock"}) {
            Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
            if (i != null) {
                startActivity(i);
                return;
            }
        }
        Toast.makeText(this, R.string.no_theme_park, Toast.LENGTH_LONG).show();
    }
}
