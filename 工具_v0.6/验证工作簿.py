import json
import sys
from pathlib import Path
from openpyxl import load_workbook

sys.stdout.reconfigure(encoding="utf-8")
mode, original_path, output_path = sys.argv[1:4]
original = load_workbook(original_path)
if mode in ("prepare", "prepare-batch"):
    if mode == "prepare-batch":
        sheet = original.worksheets[0]
        template = list(sheet.values)[1:]
        sheet.delete_rows(2, sheet.max_row)
        for company in ("验证甲科技有限公司", "验证乙科技有限公司"):
            first = True
            for values in template:
                cells = list(values)
                if cells[0] or first:
                    cells[0] = company
                    first = False
                for index, value in enumerate(cells):
                    if isinstance(value, str):
                        cells[index] = value.replace("诚通商业保理有限公司", company)
                cells[10] = None
                sheet.append(cells)
    for row in original.worksheets[0].iter_rows(min_row=2):
        if row[4].value == "司法辖区":
            row[10].value = "china_mainland"
            break
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    original.save(output_path)
    print("离线验证模板已生成，保留一项人工填写用于检查")
elif mode in ("verify", "verify-batch", "verify-real"):
    output = load_workbook(output_path)
    before, after = original.worksheets[0], output.worksheets[0]
    errors = []
    for row in before.iter_rows():
        for cell in row:
            if cell.column not in (11, 12) and cell.value != after.cell(cell.row, cell.column).value:
                errors.append(cell.coordinate)
            if cell.column == 11 and cell.value not in (None, "") and cell.value != after.cell(cell.row, 11).value:
                errors.append(cell.coordinate + "人工值被覆盖")
    assert not errors, errors
    company = ""
    checked = 0
    for row in after.iter_rows(min_row=2):
        if row[0].value:
            company = row[0].value
        if row[4].value == "营业额":
            assert isinstance(row[10].value, (int, float)) and row[10].value >= 0
            if mode != "verify-real":
                assert row[10].value == (200 if company == "验证乙科技有限公司" else 100)
            checked += 1
        if row[4].value == "员工人数":
            assert isinstance(row[10].value, int) and row[10].value >= 0
            if mode != "verify-real":
                assert row[10].value == (47 if company == "验证乙科技有限公司" else 23)
            checked += 1
    assert checked == (4 if mode == "verify-batch" else 2)
    assert "自动调查与预算" in output.sheetnames
    assert "逐项依据" in output.sheetnames
    assert "联网证据" in output.sheetnames
    formula_errors = {"#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A"}
    for sheet in output:
        for row in sheet:
            for cell in row:
                assert not (cell.data_type == "e" and cell.value in formula_errors)
    print(json.dumps({"非K/L列保持": True, "人工填写保持": True, "两类数字已核对": True, "验证模式": mode, "辅助工作表": len(output.sheetnames)}, ensure_ascii=False))
else:
    raise ValueError("仅支持prepare或verify")
