package dev.lgo.example;
import java.net.URI;
import java.util.List;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/tipos-exame") public class TipoExameController {
 private final TipoExameService service;
 public TipoExameController(TipoExameService service){this.service=service;}
 @GetMapping public List<TipoExame> list(){return service.list();}
 @GetMapping("/{codigo}") public TipoExame find(@PathVariable String codigo){return service.find(codigo);}
 @PostMapping public ResponseEntity<TipoExame> create(@Valid @RequestBody TipoExame value){TipoExame created=service.create(value);return ResponseEntity.created(URI.create("/api/tipos-exame/"+created.getCodigo())).body(created);}
 @PutMapping("/{codigo}") public TipoExame update(@PathVariable String codigo,@Valid @RequestBody TipoExame value){return service.update(codigo,value);}
 @DeleteMapping("/{codigo}") public ResponseEntity<Void> delete(@PathVariable String codigo){service.delete(codigo);return ResponseEntity.noContent().build();}
}
