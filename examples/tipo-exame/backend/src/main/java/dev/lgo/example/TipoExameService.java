package dev.lgo.example;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
@Service @Transactional public class TipoExameService {
 private final TipoExameRepository repository;
 public TipoExameService(TipoExameRepository repository){this.repository=repository;}
 @Transactional(readOnly=true) public List<TipoExame> list(){return repository.findAll();}
 @Transactional(readOnly=true) public TipoExame find(String codigo){return repository.findById(codigo).orElseThrow(()->new Missing(codigo));}
 public TipoExame create(TipoExame value){if(repository.existsById(value.getCodigo()))throw new Duplicate();return repository.save(value);}
 public TipoExame update(String codigo,TipoExame value){TipoExame existing=find(codigo);existing.setNome(value.getNome());return repository.save(existing);}
 public void delete(String codigo){repository.delete(find(codigo));}
 static class Missing extends RuntimeException {Missing(String codigo){super("Tipo de exame não encontrado: "+codigo);}}
 static class Duplicate extends RuntimeException {}
}
