import io,json,sys
from pypdf import PdfReader
sys.stdout.reconfigure(encoding='utf-8')
reader=PdfReader(io.BytesIO(sys.stdin.buffer.read()))
if len(reader.pages)>600:
 raise ValueError('PDF超过600页，请分段处理')
pages=[page.extract_text() or '' for page in reader.pages]
print(json.dumps({'pages':pages,'pageCount':len(pages)},ensure_ascii=False))
