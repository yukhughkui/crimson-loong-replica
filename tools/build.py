#!/usr/bin/env python3
"""把 MIT 许可的 three.js r180 与 src/*.js 内联成一个可离线打开的 HTML。"""
import glob, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(ROOT, "index.html")
VENDOR = os.path.join(ROOT, "vendor")


def pairs(body):
    out = []
    for item in body.split(","):
        item = item.strip()
        if not item:
            continue
        if " as " in item:
            a, b = [x.strip() for x in item.split(" as ")]
            out.append((a, b))
        else:
            out.append((item, item))
    return out


def three_bundle():
    core = open(os.path.join(VENDOR, "three.core.min.js"), encoding="utf-8").read().strip()
    mod = open(os.path.join(VENDOR, "three.module.min.js"), encoding="utf-8").read().strip()
    mc = re.search(r"export\s*\{([^}]*)\}\s*;?\s*$", core)
    core_exports = pairs(mc.group(1))
    core_body = core[:mc.start()]

    mi = re.search(r'import\s*\{([^}]*)\}\s*from\s*"\./three\.core\.min\.js"\s*;?', mod)
    imports = pairs(mi.group(1))
    mod = mod.replace(mi.group(0), "", 1)
    reexp = re.search(r'export\s*\{([^}]*)\}\s*from\s*"\./three\.core\.min\.js"\s*;?', mod)
    if reexp:
        mod = mod.replace(reexp.group(0), "", 1)
    mo = re.search(r"export\s*\{([^}]*)\}\s*;?\s*$", mod)
    own = pairs(mo.group(1))
    mod_body = mod[:mo.start()]
    again = [n for _, n in pairs(reexp.group(1))] if reexp else []

    return ("var THREE=(function(){'use strict';"
            "var __core=(function(){'use strict';" + core_body +
            ";return{" + ",".join(f"{n}:{l}" for l, n in core_exports) + "};})();"
            "var __mod=(function(__core){'use strict';var{" + ",".join(f"{n}:{l}" for n, l in imports) +
            "}=__core;" + mod_body + ";return{" +
            ",".join([f"{n}:__core.{n}" for n in again] + [f"{n}:{l}" for l, n in own]) +
            "};})(__core);return Object.freeze(Object.assign({},__core,__mod));})();")


def main():
    app, ok = [], True
    files = sorted(glob.glob(os.path.join(SRC, "*.js")))
    for f in files:
        src = open(f, encoding="utf-8").read()
        if "</script" in src.lower():
            print("bad script tag in", f)
            sys.exit(1)
        r = subprocess.run(["node", "--check", f], capture_output=True, text=True)
        if r.returncode:
            ok = False
            print("语法错误", os.path.basename(f), "\n", r.stderr[:1200])
        app.append("// ===== " + os.path.basename(f) + " =====\n" + src)
    if not ok:
        sys.exit(1)
    joined = "\n".join(app)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tf:
        tf.write(joined)
        name = tf.name
    r = subprocess.run(["node", "--check", name], capture_output=True, text=True)
    os.unlink(name)
    if r.returncode:
        print("合并后语法错误：", r.stderr[:1500])
        sys.exit(1)
    shell = open(os.path.join(SRC, "shell.html"), encoding="utf-8").read()
    out = shell.replace("{{THREE}}", three_bundle()).replace("{{APP}}", joined)
    tmp = OUT + ".tmp"
    open(tmp, "w", encoding="utf-8").write(out)
    os.replace(tmp, OUT)
    print(f"构建完成 {os.path.basename(OUT)} {len(out.encode('utf-8'))/1024:.0f} KB，{len(files)} 个模块")


if __name__ == "__main__":
    main()
