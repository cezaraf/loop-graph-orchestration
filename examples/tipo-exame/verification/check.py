"""Trusted deterministic offline oracles. Do not mistake these for Spring/browser integration."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT=Path.cwd()

def require(condition, message):
 if not condition: raise AssertionError(message)

def backend():
 source=ROOT/'backend/src/main/java/dev/lgo/example'
 policy=(source/'NotFoundPolicy.java').read_text()
 require('NotFoundPolicy.status()' in (source/'ApiAdvice.java').read_text(), 'REST advice must use tested policy')
 require(shutil.which('java'), 'ENVIRONMENT: Java JDK17+ with jdk.compiler required by executable oracle')
 with tempfile.TemporaryDirectory() as d:
  p=Path(d)
  (p/'PolicyCheck.java').write_text('import dev.lgo.example.NotFoundPolicy; public class PolicyCheck { public static void main(String[] a) { int actual=NotFoundPolicy.status(); if(actual!=404) throw new AssertionError("Expected HTTP 404 Actual HTTP "+actual); System.out.println("HTTP 404 policy PASS"); }}')
  subprocess.run(['java','com.sun.tools.javac.Main','-d',d,str(source/'NotFoundPolicy.java'),str(p/'PolicyCheck.java')],check=True,timeout=15)
  subprocess.run(['java','-cp',d,'PolicyCheck'],check=True,timeout=10)
 controller=(source/'TipoExameController.java').read_text()
 for method in ['GetMapping','PostMapping','PutMapping','DeleteMapping']:
  require('@'+method in controller, f'CRUD method absent: {method}')
 require('@Valid' in controller,'Request validation absent')
 require('JpaRepository' in (source/'TipoExameRepository.java').read_text(),'Persistence abstraction absent')
 print('backend source and executable Java policy PASS; full Spring tests separate')

def frontend():
 package=json.loads((ROOT/'frontend/package.json').read_text())
 require('@angular/core' in package['dependencies'] and 'primeng' in package['dependencies'],'Angular/PrimeNG required')
 source=(ROOT/'frontend/src/app.component.ts').read_text()
 for required in ['p-table','p-button','pInputText','this.http.post','this.http.put','this.http.delete','encodeURIComponent','form.invalid']:
  require(required in source, f'frontend contract missing: {required}')
 require('[innerHTML]' not in source,'Unsafe HTML binding')
 print('frontend source architecture PASS; browser E2E separate')

def contract():
 data=json.loads((ROOT/'contract/openapi.json').read_text())
 require(data['openapi']=='3.1.0','OpenAPI version')
 path=data['paths']['/api/tipos-exame/{codigo}']
 require({'200','404'}<=set(path['get']['responses']),'GET status contract')
 require('204' in path['delete']['responses'],'DELETE status contract')
 require({'201','400','409'}<=set(data['paths']['/api/tipos-exame']['post']['responses']),'POST status contract')
 print('OpenAPI deterministic contract PASS')

def security():
 source=ROOT/'backend/src/main/java/dev/lgo/example'
 properties=(ROOT/'backend/src/main/resources/application.properties').read_text()
 require('server.address=127.0.0.1' in properties,'Loopback binding required')
 require('server.error.include-stacktrace=never' in properties,'Stacktrace disclosure')
 controller=(source/'TipoExameController.java').read_text()
 require('Repository' not in controller,'Controller bypasses service boundary')
 require('Runtime.getRuntime' not in ''.join(p.read_text() for p in source.glob('*.java')),'OS execution prohibited')
 require('@NotBlank' in (source/'TipoExame.java').read_text(),'Blank input validation absent')
 print('security and architecture source checks PASS; unauthenticated loopback demo only')

def integration():
 for check in [contract, backend, frontend, security]: check()
 print('offline composite integration PASS; HTTP Spring/browser test suites remain distinct')

if __name__=='__main__':
 checks={'backend':backend,'frontend':frontend,'contract':contract,'security':security,'integration':integration}
 try: checks[sys.argv[1]]()
 except Exception as error:
  print(json.dumps({'verdict':'FAIL','oracle':sys.argv[1],'reason':str(error)},ensure_ascii=False), file=sys.stderr)
  sys.exit(1)
