var express    = require('express');
var app        = express();
var fs         = require("fs");
var bodyParser = require('body-parser');
var yamlconfig = require('yaml-config');
var configYaml = yamlconfig.readConfig('../config/config.yml');
var Apiclient  = require('apiclient');
var md5        = require('md5');
var path       = require("path");
var format     = require("x-date");
var formidable = require('formidable');
var fileUpload = require('express-fileupload');

var host = configYaml.document_management.host;
var port = configYaml.document_management.port;

//orm
var Database          = require("../mysql/Mysql.js");
var Api_user          = Database('User');
var Api_file          = Database('files');
var Api_file_content  = Database('files_content');
var Api_file_previews = Database('file_previews');
var Api_file_versions = Database('files_versions');

//setting midleware
app.use (function(req,res,next){
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "DELETE, GET, POST, PUT, OPTIONS");
//res.removeHeader("x-powered-by");
  next();
});

//parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));

// parse application/json
app.use(bodyParser.json());
var id = /^[0-9]*$/;
var ip = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
var valid = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

app.use(fileUpload());

var File = {
  get    : function getFile(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;

    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;  
      console.log("with Header");
      console.log(ipAddres);
    }

    console.log("without Header");
    console.log(ipAddres);   
    checkApikey(apikey, ipAddres, function(result){    
      console.log(ipAddres);                
      console.log(apikey);
      if(result.err_code==0){
        var file_id = req.params.file_id;
        if(typeof file_id !== 'undefined'){
          if(id.test(file_id)){
            //hanya boleh admin
            if(result.status=="root"){
              //query mencari file berdasarkan id
              Api_file.findById({"id": file_id}, function(err,data){
                if(err){
                  res.json(err);
                }else{
                  //show data
                  if(data.length>0){
                    //menampilkan data file
                    showFile(data,function(dataFile){
                      res.json({"err_code" : 0, "data" : dataFile});
                    });
                  }else{
                    res.json({"err_code" : 2, "err_msg": "File ID is not found"});
                  }
                }
              });
            }else{
              //hanya boleh operator menampilkan file milik sendiri
              var user_id = result.data[0].user_id;
              Api_file.findWhereAnd([{id: file_id}, {uid: user_id}], function(err,data){
                if(err){
                  res.json(err);
                }else{
                  //show data
                  if(data.length>0){
                    //menampilkan data file
                    showFile(data,function(dataFile){
                      res.json({"err_code" : 0, "data" : dataFile});
                    });
                  }else{
                    res.json({"err_code" : 2, "err_msg": "File is not found"});
                  }
                }
              });
              //res.json({"err_code": 5, "err_msg": "Access denied to view file"});
            }
          }else{
            res.json({"err_code" : 2, "err_msg": "File ID must be numeric"});
          }
        }else{
          //check akses get all file, hanya boleh admin
          if(result.status=="root"){
            //query untuk menampilkan semua list file
            Api_file.find({}, function(err,data){
              if(err){
                if(data.errcode==1)
                  res.json(data);
                else
                  res.json(err);
              }else{
                //cek jumdata dulu
                if(data.length > 0){
                  //menampilkan data file
                  showFile(data,function(dataFile){
                    res.json({"err_code": 0, "data":dataFile});
                  });
                }else{
                  res.json({"err_code": 4, "err_msg": "File data is empty", "application": "Api Document Management", "function": "getFile"});
                }
              }
            });
          }else{
            //query untuk menampilkan semua list file milik sendiri, hanya boleh operator
            var user_id = result.data[0].user_id;
            checkFileUser(user_id, function(result2){
              if(result2.err_code==0){
                res.json({"data":result2.data});
              }else{
                res.json({"err_code":result2.err_code, "message": result2.status});
              }
            });
            //res.json({"err_code": 6, "err_msg": "Access denied to view files"});
          }
        }
      }else{
        result.err_code = 500;
        res.json(result);
      }
    });
  },
  post   : function addFile(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;
        
    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;          
    } 
    
    checkApikey(apikey, ipAddres, function(result){
      //check akses tambah file
      if(result.status=="root"||result.status=="active"){
        if(typeof req.body.user_id !== 'undefined'&& req.body.user_id!==""){
          var user_id = req.body.user_id;
          //check id user telah terdaftar ditable user atau belum
          checkUser(user_id, function(result2){
            if(result2.err_code == 0){
              if(typeof req.body.content_id !== 'undefined'&& req.body.content_id!==""){
                var content_id = req.body.content_id;
                //check id content telah terdaftar ditable content atau belum
                checkFileContent(content_id, function(result3){
                  if(result3.err_code == 0){
                    //res.json({"status":result3.status, "data":result3.data});
                    if(typeof req.body.file_name !== 'undefined'&& req.body.file_name!==""){
                      if(typeof req.body.file_cid !== 'undefined' && req.body.file_cid !== ""){

                        if(typeof req.body.file_date !== 'undefined' && req.body.file_date !== "")
                          var file_date = req.body.file_date;
                        else
                          var file_date = null;

                        if(typeof req.body.file_title !== 'undefined' && req.body.file_title !== "")
                          var file_title = req.body.file_title;
                        else
                          var file_title = "";

                        //ambil id file terakhir
                        getFileId(apikey, function(result4){
                          if(result4.err_code == 0){
                            var dataFile = {
                              "id": result4.file_id,
                              "content_id": content_id,
                              "date": file_date,
                              "name": req.body.file_name.replace(/ /g,""),
                              "title": file_title.replace(/ /g,""),
                              "cid": req.body.file_cid,
                              "uid": user_id,
                              "cdate": getFormattedDate()
                            };
                            //proses tambah data file ke database
                            console.log(dataFile);
                            Api_file.add(dataFile,function(err,data){
                              //cek apakah ada error atau tidak
                              if(err){
                                res.json({"err_code": 1, "err_msg": err, "application": "Api File Management", "function": "addFile"});
                              }else{
                                if(data.errcode == 0){
                                  //ambil data file yang sudah di tambahkan
                                  Api_file.findById({"id": result4.file_id}, function(err,datapost){
                                    showFile(datapost,function(dataFile){
                                      res.json({"err_code": 0, "data" : dataFile});
                                    });
                                  });
                                }else{
                                  res.json(data);
                                }
                              }
                            });
                          }else{
                            result.err_code = 500;
                            res.json(result4.err_code);
                          }
                        });
                      }else{
                        res.json({"err_code" : 2, "status" : "File cid is required"});
                      }
                    }else{
                      res.json({"err_code" : 4, "status" : "File name is required"});
                    }
                  }else{
                    var err = result.err_code = 500;
                    res.json({"error":err, "message":result3.status});
                  }
                });
              }else{
                res.json({"err_code" : 10, "status" : "Content id is required"});
              }
            }else{
              var err = result.err_code = 500;
              res.json({"error":err, "message":result2.status});
            }
          });
        }else{
          res.json({"err_code" : 10, "status" : "User id is required"});
        }
      }else{
        res.json({"err_code": 3, "err_msg": "Access denied"});
      }
    });
  },
  put    : function updateFile(req, res){
    if(Object.keys(req.body).length){
      var ipAddres = req.connection.remoteAddress;
      var apikey = req.params.apikey;
      var ipAddresHeader = req.headers.api;

      //check ip dengan header
      if (typeof ipAddresHeader !== 'undefined') {
        ipAddres = ipAddresHeader;
      }

      checkApikey(apikey, ipAddres, function(result){
        if(result.err_code == 0){
          var file_id = req.params.file_id;
          if(typeof file_id !== 'undefined'&&id.test(file_id)){
            //cek data file yang akan diupdate
            checkFile(file_id,function(result2){
              if(result2.err_code==0){
                //check akses update
                if(result.status=="root"||result.status=="active"){
                  var dataFile= {};
                  var params = true;

                  /*if(typeof req.body.content_id !== 'undefined'&&req.body.content_id!==""){
                    var content_id = req.body.content_id;
                    checkFileContent(content_id,function(result3){
                      if (result3.err_code==0){
                        dataFile.content_id = content_id;
                      }else{
                        params=false;
                      }
                    });
                  }else if(req.body.content_id==""){
                    params=false;
                  }*/

                  if(typeof req.body.content_id !== 'undefined'&&req.body.content_id!==""){
                    dataFile.content_id = req.body.content_id;
                  }else if(req.body.content_id==""){
                    params=false;
                  }

                  if(typeof req.body.date !== 'undefined'&&req.body.date!==""){
                    var file_date = req.body.date;
                    if (file_date == "null")
                      dataFile.date = null;
                    else
                      dataFile.date = req.body.date;
                  }
                  else if(req.body.date ==""){
                    params=false;
                  }

                  if(typeof req.body.name !== 'undefined'&&req.body.name!=="")
                    dataFile.name = req.body.name.replace(/ /g,"");
                  else if(req.body.name =="")
                    params=false;

                  if(typeof req.body.title !== 'undefined'&&req.body.title!=="")
                    dataFile.title = req.body.title.replace(/ /g,"");
                  else if(req.body.title =="")
                    params=false;

                  if(typeof req.body.cid !== 'undefined'&&req.body.cid!=="")
                    dataFile.cid = req.body.cid;
                  else if(req.body.cid =="")
                    params=false;

                  dataFile.udate = getFormattedDate();
                  if(params){
                    Api_file.update({"id" : file_id},dataFile,function(err,data){
                      if(err){
                        if(data.errcode==1)
                          res.json(data);
                        else
                          res.json(err);
                      }else{
                        Api_file.findById({"id": file_id}, function(err,dataUpdate){
                          showFile(dataUpdate,function(dataFile){
                            res.json({"err_code": 0, "data" : dataFile});
                          });
                        });
                      }
                    });
                  }else{
                    res.json({"err_code" : 3, "status" : "Parameters cannot Empty"});
                  }
                }else{
                  res.json({"err_code": 3, "err_msg": "Access denied"});
                }
              }else if(result2.err_code==1){
                res.json({"err_code": 2, "err_msg": "File ID is not found"});
              }else{
                res.json({"err_code": 3, "err_msg": "Access denied"});
              }
            });
          }else{
            res.json({"err_code": 2, "err_msg": "File ID must be numeric"});
          }
        }else{
          result.err_code = 500;
          res.json(result);
        }
      });
    }else{
      res.json({"err_code": 500, "err_msg": "Body cannot Empty"});
    }
  },
  delete : function deleteFile(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;
        
    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;          
    }

    checkApikey(apikey, ipAddres, function(result){
      if(result.err_code == 0){
        //proses query ambil data file
        var file_id = req.params.file_id;
        if(typeof file_id !== 'undefined'){
          if(id.test(file_id)){
            //check akses delete
            if(result.status=="root"||result.status=="active"){
              //hapus file
              Api_file.delete([{"id" : file_id}], function(err1,dataFile){
                if(dataFile.errcode==1){
                  res.json({"err_code": 2, "err_msg": "File ID is not found"});
                }else{
                  //hapus data di file version yang file id nya telah dihapus
                  Api_file_versions.delete([{"file_id" : file_id}], function(err2,dataFileVersion){});
                  /*Api_file_versions.delete([{"file_id" : file_id}], function(err2,dataFileVersion){
                    if(dataFileVersion.errcode==1){
                      res.json({"err_code": 2, "err_msg": "File ID is not found in file version"});
                    }else{
                      Api_file_versions.find({}, function(err,data){
                        if(err){
                          if(data.errcode==1)
                            res.json(data);
                          else
                            res.json(err);
                        }else{
                          //cek jumdata dulu
                          if(data.length > 0){
                            //menampilkan data file version
                            showFileVersion(data,function(dataFileVersion){
                              res.json({"err_code": 0, "data":dataFileVersion});
                            });
                          }else{
                            res.json({"err_code": 4, "err_msg": "File data is empty", "application": "Api Document Management", "function": "deleteFile"});
                          }
                        }
                      });
                    }
                  });*/
                  //tampilkan semua data setelah selesai hapus
                  Api_file.find({}, function(err,data){
                    if(err){
                      if(data.errcode==1)
                        res.json(data);
                      else
                       res.json(err);
                    }else{
                      //cek jumdata dulu
                      if(data.length > 0){
                        //menampilkan data file
                        showFile(data,function(dataFile){
                          res.json({"err_code": 0, "data":dataFile});
                        });
                      }else{
                        res.json({"err_code": 4, "err_msg": "File data is empty", "application": "Api Document Management", "function": "deleteFile"});
                      }
                    }
                  });
                }
              });
            }else{
              res.json({"err_code": 3, "err_msg": "Access denied for this file"});
            }
          }else{
            res.json({"err_code": 2, "err_msg": "File ID must be numeric"});
          }
        }else{
          res.json({"err_code": 1, "err_msg": "File ID is required"});
        }
      }else{
        result.err_code = 500;
        res.json(result);
      }
    });
  }
}

var Content = {
  get    : function getFileContent(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;

    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;  
      console.log("with Header");
      console.log(ipAddres);
    }

    console.log("without Header");
    console.log(ipAddres);   
    checkApikey(apikey, ipAddres, function(result){    
      console.log(ipAddres);                
      console.log(apikey);
      if(result.err_code==0){
        var content_id = req.params.content_id;
        if(typeof content_id !== 'undefined'){
          if(id.test(content_id)){
            if(result.status=="root"||result.status=="active"){
              //query mencari file content berdasarkan id
              Api_file_content.findById({"id": content_id}, function(err,data){
                if(err){
                  res.json(err);
                }else{
                  //show data
                  if(data.length>0){
                    //menampilkan data file content
                    showFileContent(data,function(dataFileContent){
                      res.json({"err_code" : 0, "data" : dataFileContent});
                    });
                  }else{
                    res.json({"err_code" : 2, "err_msg": "File Content ID is not found"});
                  }
                }
              });
            }else{
              res.json({"err_code": 5, "err_msg": "Access denied to view file content"});
            }
          }else{
            res.json({"err_code" : 2, "err_msg": "File Content ID must be numeric"});
          }
        }else{
          //check akses get all file content
          if(result.status=="root"||result.status=="active"){
            //query untuk menampilkan semua list file content
            Api_file_content.find({}, function(err,data){
              if(err){
                if(data.errcode==1)
                  res.json(data);
                else
                  res.json(err);
              }else{
                //cek jumdata dulu
                if(data.length > 0){
                  //menampilkan data file content
                  showFileContent(data,function(dataFileContent){
                    res.json({"err_code": 0, "data":dataFileContent});
                  });
                }else{
                  res.json({"err_code": 4, "err_msg": "File content data is empty", "application": "Api Document Management", "function": "getFileContent"});
                }
              }
            });
          }else{
            res.json({"err_code": 6, "err_msg": "Access denied to view files content"});
          }
        }
      }else{
        result.err_code = 500;
        res.json(result);
      }
    });
  },
  post   : function addFileContent(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;
        
    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;          
    } 
    
    checkApikey(apikey, ipAddres, function(result){
      if(result.err_code==0){
        if(typeof req.body.content_size !== 'undefined'&& req.body.content_size!==""){
          if(typeof req.body.content_path !== 'undefined'&& req.body.content_path!==""){
            if(typeof req.body.content_refcount !== 'undefined' && req.body.content_refcount !== ""){
              if(typeof req.body.content_md5 !== 'undefined' && req.body.content_md5 !== ""){
                var location=req.body.content_path;
                var checksum_file = req.body.content_md5;

                if(typeof req.body.content_pages !== 'undefined' && req.body.content_pages !== "")
                  var content_pages = req.body.content_pages;
                else
                  var content_pages = null;

                if(typeof req.body.content_type !== 'undefined' && req.body.content_type !== "")
                  var content_type = req.body.content_type;
                else
                  var content_type = "";

                //ambil id file content terakhir
                getFileContentId(apikey, function(result2){
                  if(result2.err_code == 0){
                    var dataFileContent = {
                      "id": result2.content_id,
                      "size": req.body.content_size,
                      "pages": content_pages,
                      "type": content_type,
                      "path": req.body.content_path,
                      "ref_count": req.body.content_refcount,
                      "parse_status": true,
                      "skip_parsing": false,
                      "md5": generateFileChecksum(location+checksum_file)
                    };
                    //proses tambah data file content ke database
                    console.log(dataFileContent);
                    Api_file_content.add(dataFileContent,function(err,data){
                      //cek apakah ada error atau tidak
                      if(err){
                        res.json({"err_code": 1, "err_msg": err, "application": "Api File Management", "function": "addFileContent"});
                      }else{
                        if(data.errcode == 0){
                          //ambil data file content yang sudah di tambahkan
                          Api_file_content.findById({"id": result2.content_id}, function(err,datapost){
                            showFileContent(datapost,function(dataFileContent){
                              res.json({"err_code": 0, "data" : dataFileContent});
                            });
                          });
                        }else{
                          res.json(data);
                        }
                      }
                    });
                  }else{
                    result.err_code = 500;
                    res.json(result2.err_code);
                  }
                });
              }else{
                res.json({"err_code" : 4, "status" : "File content md5 is required"});
              }
            }else{
              res.json({"err_code" : 4, "status" : "File content ref count is required"});
            }
          }else{
            res.json({"err_code" : 3, "status" : "File content path is required"});
          }
        }else{
          res.json({"err_code" : 2, "status" : "File content size is required"});
        }
      }else{
        res.json({"err_code": 1, "err_msg": "Access denied"});
      }
    });
  },
  put    : function updateFileContent(req, res){
    if(Object.keys(req.body).length){
      var ipAddres = req.connection.remoteAddress;
      var apikey = req.params.apikey;
      var ipAddresHeader = req.headers.api;

      //check ip dengan header
      if (typeof ipAddresHeader !== 'undefined') {
        ipAddres = ipAddresHeader;
      }

      checkApikey(apikey, ipAddres, function(result){
        if(result.err_code==0){
          var content_id = req.params.content_id;
          if(typeof content_id !== 'undefined'&&id.test(content_id)){
            //cek data file content yang akan diupdate
            checkFileContent(content_id,function(result2){
              if(result2.err_code==0){
                //check akses update
                if(result.status=="root"||result.status=="active"){
                  var dataFileContent= {};
                  var params = true;

                  if(typeof req.body.size !== 'undefined'&&req.body.size!=="")
                    dataFileContent.size = req.body.size;
                  else if(req.body.size=="")
                    params=false;

                  if(typeof req.body.pages !== 'undefined'&&req.body.pages!=="")
                    dataFileContent.pages = req.body.pages;
                  else if(req.body.pages =="")
                    params=false;

                  if(typeof req.body.type !== 'undefined'&&req.body.type!=="")
                    dataFileContent.type = req.body.type;
                  else if(req.body.type =="")
                    params=false;

                  if(typeof req.body.path !== 'undefined'&&req.body.path!=="")
                    dataFileContent.path = req.body.path;
                  else if(req.body.path =="")
                    params=false;

                  if(typeof req.body.ref_count !== 'undefined'&&req.body.ref_count!=="")
                    dataFileContent.ref_count = req.body.ref_count;
                  else if(req.body.ref_count =="")
                    params=false;

                  /*if(typeof req.body.parse_status !== 'undefined'&&req.body.parse_status!=="")
                    dataFileContent.parse_status = req.body.parse_status;
                  else if(req.body.parse_status =="")
                    params=false;

                  if(typeof req.body.skip_parsing !== 'undefined'&&req.body.skip_parsing!=="")
                    dataFileContent.skip_parsing = req.body.skip_parsing;
                  else if(req.body.skip_parsing =="")
                    params=false;*/

                  if(typeof req.body.parse_status !== 'undefined'&&req.body.parse_status!==""){
                    var content_parse_status = req.body.parse_status;
                    if (content_parse_status == "true" || content_parse_status == "1")
                      dataFileContent.parse_status = true;
                    else
                      dataFileContent.parse_status = false;
                  }
                  else if(req.body.parse_status ==""){
                    params=false;
                  }

                  if(typeof req.body.skip_parsing !== 'undefined'&&req.body.skip_parsing!==""){
                    var content_skip_parsing = req.body.skip_parsing;
                    if (content_skip_parsing == "true"|| content_skip_parsing == "1")
                      dataFileContent.skip_parsing = true;
                    else
                      dataFileContent.skip_parsing = false;
                  }
                  else if(req.body.skip_parsing ==""){
                    params=false;
                  }

                  if(typeof req.body.md5 !== 'undefined'&&req.body.md5!=="")
                    dataFileContent.md5 = generateFileChecksum(req.body.path+req.body.md5);
                  else if(req.body.md5 =="")
                    params=false;

                  if(params){
                    Api_file_content.update({"id" : content_id},dataFileContent,function(err,data){
                      if(err){
                        if(data.errcode==1)
                          res.json(data);
                        else
                          res.json(err);
                      }else{
                        Api_file_content.findById({"id": content_id}, function(err,dataUpdate){
                          showFileContent(dataUpdate,function(dataFileContent){
                            res.json({"err_code": 0, "data" : dataFileContent});
                          });
                        });
                      }
                    });
                  }else{
                    res.json({"err_code" : 3, "status" : "Parameters cannot Empty"});
                  }
                }else{
                  res.json({"err_code": 3, "err_msg": "Access denied"});
                }
              }else if(result2.err_code==1){
                res.json({"err_code": 2, "err_msg": "File Content ID is not found"});
              }else{
                res.json({"err_code": 3, "err_msg": "Access denied"});
              }
            });
          }else{
            res.json({"err_code": 2, "err_msg": "File Content ID must be numeric"});
          }
        }else{
          //result.err_code = 500;
          //res.json(result);
          res.json({"err_code": 4, "err_msg": "Access denied"});
        }
      });
    }else{
      res.json({"err_code": 500, "err_msg": "Body cannot Empty"});
    }
  },
  delete : function deleteFileContent(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;
        
    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;          
    }

    checkApikey(apikey, ipAddres, function(result){
      if(result.err_code == 0){
        //proses query ambil data file content
        var content_id = req.params.content_id;
        if(typeof content_id !== 'undefined'){
          if(id.test(content_id)){
            //check akses delete
            if(result.status=="root"||result.status=="active"){
              //hapus file content
              Api_file_content.delete([{"id" : content_id}], function(err1,dataFileContent){
                if(dataFileContent.errcode==1){
                  res.json({"err_code": 2, "err_msg": "File Content ID is not found"});
                }else{
                  //hapus data di file version yang content id nya telah dihapus
                  Api_file_versions.delete([{"content_id" : content_id}], function(err2,dataFileVersion){});
                  //hapus data di file previews yang content id nya telah dihapus
                  Api_file_previews.delete([{"content_id" : content_id}], function(err3,dataFilePreview){});
                  //hapus data di file yang content id nya telah dihapus
                  Api_file.delete([{"content_id" : content_id}], function(err4,dataFile){});
                  //tampilkan semua data content setelah selesai hapus
                  Api_file_content.find({}, function(err,data){
                    if(err){
                      if(data.errcode==1)
                        res.json(data);
                      else
                       res.json(err);
                    }else{
                      //cek jumdata dulu
                      if(data.length > 0){
                        //menampilkan data file content
                        showFileContent(data,function(dataFileContent){
                          res.json({"err_code": 0, "data":dataFileContent});
                        });
                      }else{
                        res.json({"err_code": 5, "err_msg": "File data content is empty", "application": "Api Document Management", "function": "deleteFileContent"});
                      }
                    }
                  });
                }
              });
            }else{
              res.json({"err_code": 4, "err_msg": "Access denied for this file content"});
            }
          }else{
            res.json({"err_code": 3, "err_msg": "File Content ID must be numeric"});
          }
        }else{
          res.json({"err_code": 2, "err_msg": "File Content ID is required"});
        }
      }else{
        //result.err_code = 500;
        //res.json(result);
        res.json({"err_code": 1, "err_msg": "Access denied"});
      }
    });
  }
}

var Preview = {
  get    : function getFilePreview(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;

    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;  
      console.log("with Header");
      console.log(ipAddres);
    }

    console.log("without Header");
    console.log(ipAddres);   
    checkApikey(apikey, ipAddres, function(result){    
      console.log(ipAddres);                
      console.log(apikey);
      if(result.err_code==0){
        var preview_id = req.params.preview_id;
        if(typeof preview_id !== 'undefined'){
          if(id.test(preview_id)){
            if(result.status=="root"||result.status=="active"){
              //query mencari file preview berdasarkan content id
              Api_file_previews.findById({"id": preview_id}, function(err,data){
                if(err){
                  res.json(err);
                }else{
                  //show data
                  if(data.length>0){
                    //menampilkan data file preview
                    showFilePreview(data,function(dataFilePreview){
                      res.json({"err_code" : 0, "data" : dataFilePreview});
                    });
                  }else{
                    res.json({"err_code" : 2, "err_msg": "File Preview Content ID is not found"});
                  }
                }
              });
            }else{
              res.json({"err_code": 5, "err_msg": "Access denied to view file preview"});
            }
          }else{
            res.json({"err_code" : 2, "err_msg": "File Preview Content ID must be numeric"});
          }
        }else{
          //check akses get all file preview
          if(result.status=="root"||result.status=="active"){
            //query untuk menampilkan semua list file preview
            Api_file_previews.find({}, function(err,data){
              if(err){
                if(data.errcode==1)
                  res.json(data);
                else
                  res.json(err);
              }else{
                //cek jumdata dulu
                if(data.length > 0){
                  //menampilkan data file preview
                  showFilePreview(data,function(dataFilePreview){
                    res.json({"err_code": 0, "data":dataFilePreview});
                  });
                }else{
                  res.json({"err_code": 4, "err_msg": "File preview data is empty", "application": "Api Document Management", "function": "getFilePreview"});
                }
              }
            });
          }else{
            res.json({"err_code": 6, "err_msg": "Access denied to view files preview"});
          }
        }
      }else{
        result.err_code = 500;
        res.json(result);
      }
    });
  },
  post   : function addFilePreview(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;
        
    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;          
    } 
    
    checkApikey(apikey, ipAddres, function(result){
      if(result.err_code==0){
        if(typeof req.body.content_id !== 'undefined'&& req.body.content_id!==""){
          var content_id = req.body.content_id;
          checkFileContent(content_id, function(result2){
            if(result2.err_code == 0){
              if(typeof req.body.preview_group !== 'undefined'&& req.body.preview_group!==""){
                if(typeof req.body.preview_filename !== 'undefined' && req.body.preview_filename !== ""){
                  if(typeof req.body.preview_size !== 'undefined' && req.body.preview_size !== ""){
              
                    if(typeof req.body.preview_status !== 'undefined' && req.body.preview_status !== "")
                      var preview_status = true;
                    else
                      var preview_status = false;

                    if(typeof req.body.preview_ladate !== 'undefined' && req.body.preview_ladate !== "")
                      var preview_ladate = req.body.preview_ladate;
                    else
                      var preview_ladate = null;

                    //ambil id file preview terakhir
                    getFilePreviewId(apikey, function(result3){
                      if(result3.err_code == 0){
                        var dataFilePreview = {
                          "id": result3.preview_id,
                          "content_id": content_id,
                          "group": req.body.preview_group,
                          "status": preview_status,
                          "filename": req.body.preview_filename,
                          "size": req.body.preview_size,
                          "cdate": getFormattedDate(),
                          "ladate": preview_ladate
                        };
                        //proses tambah data file preview ke database
                        console.log(dataFilePreview);
                        Api_file_previews.add(dataFilePreview,function(err,data){
                          //cek apakah ada error atau tidak
                          if(err){
                            res.json({"err_code": 1, "err_msg": err, "application": "Api File Management", "function": "addFilePreview"});
                          }else{
                            if(data.errcode == 0){
                              //ambil data file preview yang sudah di tambahkan
                              Api_file_previews.findById({"id": result3.preview_id}, function(err,datapost){
                                showFilePreview(datapost,function(dataFilePreview){
                                  res.json({"err_code": 0, "data" : dataFilePreview});
                                });
                              });
                            }else{
                              res.json(data);
                            }
                          }
                        });
                      }else{
                        result.err_code = 500;
                        res.json(result3.err_code);
                      }
                    });
                  }else{
                    res.json({"err_code" : 4, "status" : "File preview size is required"});
                  }
                }else{
                  res.json({"err_code" : 4, "status" : "File preview filename is required"});
                }
              }else{
                res.json({"err_code" : 3, "status" : "File preview group is required"});
              }
            }else{
              var err = result.err_code = 500;
              res.json({"error":err, "message":result2.status});
            }
          });
        }else{
          res.json({"err_code" : 2, "status" : "File Content ID is required"});
        }
      }else{
        res.json({"err_code": 1, "err_msg": "Access denied"});
      }
    });
  },
  put    : function updateFilePreview(req, res){
    if(Object.keys(req.body).length){
      var ipAddres = req.connection.remoteAddress;
      var apikey = req.params.apikey;
      var ipAddresHeader = req.headers.api;

      //check ip dengan header
      if (typeof ipAddresHeader !== 'undefined') {
        ipAddres = ipAddresHeader;
      }

      checkApikey(apikey, ipAddres, function(result){
        if(result.err_code==0){
          var preview_id = req.params.preview_id;
          if(typeof preview_id !== 'undefined'&&id.test(preview_id)){
            //cek data file preview yang akan diupdate
            checkFilePreview(preview_id,function(result2){
              if(result2.err_code==0){
                //check akses update
                if(result.status=="root"||result.status=="active"){
                  var dataFilePreview= {};
                  var params = true;

                  if(typeof req.body.content_id !== 'undefined'&&req.body.content_id!=="")
                    dataFilePreview.content_id = req.body.content_id;
                  else if(req.body.content_id=="")
                    params=false;

                  if(typeof req.body.group !== 'undefined'&&req.body.group!=="")
                    dataFilePreview.group = req.body.group;
                  else if(req.body.group =="")
                    params=false;

                  if(typeof req.body.status !== 'undefined'&&req.body.status!==""){
                    var preview_status = req.body.status;
                    if (preview_status == "true" || preview_status == "1")
                      dataFilePreview.status = true;
                    else
                      dataFilePreview.status = false;
                  }
                  else if(req.body.status ==""){
                    params=false;
                  }

                  if(typeof req.body.filename !== 'undefined'&&req.body.filename!=="")
                    dataFilePreview.filename = req.body.filename;
                  else if(req.body.filename =="")
                    params=false;

                  if(typeof req.body.size !== 'undefined'&&req.body.size!=="")
                    dataFilePreview.size = req.body.size;
                  else if(req.body.size =="")
                    params=false;

                  if(typeof req.body.ladate !== 'undefined'&&req.body.ladate!==""){
                    var preview_ladate = req.body.ladate;
                    if (preview_ladate == "null")
                      dataFilePreview.ladate = null;
                    else
                      dataFilePreview.ladate = req.body.ladate;
                  }
                  else if(req.body.ladate ==""){
                    params=false;
                  }

                  if(params){
                    Api_file_previews.update({"id" : preview_id},dataFilePreview,function(err,data){
                      if(err){
                        if(data.errcode==1)
                          res.json(data);
                        else
                          res.json(err);
                      }else{
                        Api_file_previews.findById({"id": preview_id}, function(err,dataUpdate){
                          showFilePreview(dataUpdate,function(dataFilePreview){
                            res.json({"err_code": 0, "data" : dataFilePreview});
                          });
                        });
                      }
                    });
                  }else{
                    res.json({"err_code" : 3, "status" : "Parameters cannot Empty"});
                  }
                }else{
                  res.json({"err_code": 3, "err_msg": "Access denied"});
                }
              }else if(result2.err_code==1){
                res.json({"err_code": 2, "err_msg": "File Preview ID is not found"});
              }else{
                res.json({"err_code": 3, "err_msg": "Access denied"});
              }
            });
          }else{
            res.json({"err_code": 2, "err_msg": "File Preview ID must be numeric"});
          }
        }else{
          //result.err_code = 500;
          //res.json(result);
          res.json({"err_code": 4, "err_msg": "Access denied"});
        }
      });
    }else{
      res.json({"err_code": 500, "err_msg": "Body cannot Empty"});
    }
  },
  delete : function deleteFilePreview(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;
        
    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;          
    }

    checkApikey(apikey, ipAddres, function(result){
      if(result.err_code == 0){
        //proses query ambil data file priview
        var preview_id = req.params.preview_id;
        if(typeof preview_id !== 'undefined'){
          if(id.test(preview_id)){
            //check akses delete
            if(result.status=="root"||result.status=="active"){
              //hapus file preview
              Api_file_previews.delete([{"id" : preview_id}], function(err1,dataFilePreview){
                if(dataFilePreview.errcode==1){
                  res.json({"err_code": 2, "err_msg": "File Preview ID is not found"});
                }else{
                  //tampilkan semua data preview setelah selesai hapus
                  Api_file_previews.find({}, function(err,data){
                    if(err){
                      if(data.errcode==1)
                        res.json(data);
                      else
                       res.json(err);
                    }else{
                      //cek jumdata dulu
                      if(data.length > 0){
                        //menampilkan data file preview
                        showFilePreview(data,function(dataFilePreview){
                          res.json({"err_code": 0, "data":dataFilePreview});
                        });
                      }else{
                        res.json({"err_code": 5, "err_msg": "File data preview is empty", "application": "Api Document Management", "function": "deleteFilePreview"});
                      }
                    }
                  });
                }
              });
            }else{
              res.json({"err_code": 4, "err_msg": "Access denied for this file preview"});
            }
          }else{
            res.json({"err_code": 3, "err_msg": "File Preview ID must be numeric"});
          }
        }else{
          res.json({"err_code": 2, "err_msg": "File Preview ID is required"});
        }
      }else{
        //result.err_code = 500;
        //res.json(result);
        res.json({"err_code": 1, "err_msg": "Access denied"});
      }
    });
  }
}

var Version = {
  get    : function getFileVersion(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;

    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;  
      console.log("with Header");
      console.log(ipAddres);
    }

    console.log("without Header");
    console.log(ipAddres);   
    checkApikey(apikey, ipAddres, function(result){    
      console.log(ipAddres);                
      console.log(apikey);
      if(result.err_code==0){
        var version_id = req.params.version_id;
        if(typeof version_id !== 'undefined'){
          if(id.test(version_id)){
            //hanya boleh admin
            if(result.status=="root"){
              //query mencari file version berdasarkan id
              Api_file_versions.findById({"id": version_id}, function(err,data){
                if(err){
                  res.json(err);
                }else{
                  //show data
                  if(data.length>0){
                    //menampilkan data file version
                    showFileVersion(data,function(dataFileVersion){
                      res.json({"err_code" : 0, "data" : dataFileVersion});
                    });
                  }else{
                    res.json({"err_code" : 2, "err_msg": "File Version ID is not found"});
                  }
                }
              });
            }else{
              //hanya boleh operator menampilkan file version milik sendiri
              var user_id = result.data[0].user_id;
              Api_file_versions.findWhereAnd([{id: version_id}, {uid: user_id}], function(err,data){
                if(err){
                  res.json(err);
                }else{
                  //show data
                  if(data.length>0){
                    //menampilkan data file version
                    showFileVersion(data,function(dataFileVersion){
                      res.json({"err_code" : 0, "data" : dataFileVersion});
                    });
                  }else{
                    res.json({"err_code" : 2, "err_msg": "File version is not found"});
                  }
                }
              });
            }
          }else{
            res.json({"err_code" : 2, "err_msg": "File Version ID must be numeric"});
          }
        }else{
          //check akses get all file version, hanya boleh admin
          if(result.status=="root"){
            //query untuk menampilkan semua list file version
            Api_file_versions.find({}, function(err,data){
              if(err){
                if(data.errcode==1)
                  res.json(data);
                else
                  res.json(err);
              }else{
                //cek jumdata dulu
                if(data.length > 0){
                  //menampilkan data file version
                  showFileVersion(data,function(dataFileVersion){
                    res.json({"err_code": 0, "data":dataFileVersion});
                  });
                }else{
                  res.json({"err_code": 4, "err_msg": "File data is empty", "application": "Api Document Management", "function": "getFileVersion"});
                }
              }
            });
          }else{
            //query untuk menampilkan semua list file version milik sendiri, hanya boleh operator
            var user_id = result.data[0].user_id;
            checkFileVersionUser(user_id, function(result2){
              if(result2.err_code==0){
                res.json({"data":result2.data});
              }else{
                res.json({"err_code":result2.err_code, "message": result2.status});
              }
            });
          }
        }
      }else{
        result.err_code = 500;
        res.json(result);
      }
    });
  },
  post   : function addFileVersion(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;
        
    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;          
    } 
    
    checkApikey(apikey, ipAddres, function(result){
      //check akses tambah file
      if(result.status=="root"||result.status=="active"){
        if(typeof req.body.file_id !== 'undefined'&& req.body.file_id!==""){
          var file_id = req.body.file_id;
          //check file id telah terdaftar ditable file atau belum
          checkFile(file_id, function(result2){
            if(result2.err_code == 0){
              
                        if(typeof req.body.version_date !== 'undefined' && req.body.version_date !== "")
                          var version_date = req.body.version_date;
                        else
                          var version_date = null;

                        //ambil id version terakhir
                        getFileVersionId(apikey, function(result3){
                          if(result3.err_code == 0){
                            var dataFileVersion = {
                              "id": result3.version_id,
                              "file_id": result2.data[0].id,
                              "content_id": result2.data[0].content_id,
                              "date": version_date,
                              "name": result2.data[0].name.replace(/ /g,""),
                              "cid": result2.data[0].cid,
                              "uid": result2.data[0].uid,
                              "cdate": getFormattedDate()
                            };
                            //proses tambah data file version ke database
                            console.log(dataFileVersion);
                            Api_file_versions.add(dataFileVersion,function(err,data){
                              //cek apakah ada error atau tidak
                              if(err){
                                res.json({"err_code": 1, "err_msg": err, "application": "Api File Management", "function": "addFileVersion"});
                              }else{
                                if(data.errcode == 0){
                                  //ambil data file version yang sudah di tambahkan
                                  Api_file_versions.findById({"id": result3.version_id}, function(err,datapost){
                                    showFileVersion(datapost,function(dataFileVersion){
                                      res.json({"err_code": 0, "data" : dataFileVersion});
                                    });
                                  });
                                }else{
                                  res.json(data);
                                }
                              }
                            });
                          }else{
                            result.err_code = 500;
                            res.json(result3.err_code);
                          }
                        });
            }else{
              var err = result.err_code = 500;
              res.json({"error":err, "message":result2.status});
            }
          });
        }else{
          res.json({"err_code" : 10, "status" : "File id is required"});
        }
      }else{
        res.json({"err_code": 3, "err_msg": "Access denied"});
      }
    });
  },
  put    : function updateFileVersion(req, res){
    if(Object.keys(req.body).length){
      var ipAddres = req.connection.remoteAddress;
      var apikey = req.params.apikey;
      var ipAddresHeader = req.headers.api;

      //check ip dengan header
      if (typeof ipAddresHeader !== 'undefined') {
        ipAddres = ipAddresHeader;
      }

      checkApikey(apikey, ipAddres, function(result){
        if(result.err_code == 0){
          var version_id = req.params.version_id;
          if(typeof version_id !== 'undefined'&&id.test(version_id)){
            //cek data file version yang akan diupdate
            checkFileVersion(version_id,function(result2){
              if(result2.err_code==0){
                //check akses update
                if(result.status=="root"||result.status=="active"){
                  var dataFileVersion= {};
                  var params = true;

                  if(typeof req.body.file_id !== 'undefined'&&req.body.file_id!==""){
                    dataFileVersion.file_id = req.body.file_id;
                  }else if(req.body.file_id==""){
                    params=false;
                  }

                  if(typeof req.body.content_id !== 'undefined'&&req.body.content_id!==""){
                    dataFileVersion.content_id = req.body.content_id;
                  }else if(req.body.content_id==""){
                    params=false;
                  }

                  if(typeof req.body.date !== 'undefined'&&req.body.date!==""){
                    var file_date = req.body.date;
                    if (file_date == "null")
                      dataFileVersion.date = null;
                    else
                      dataFileVersion.date = req.body.date;
                  }
                  else if(req.body.date ==""){
                    params=false;
                  }

                  if(typeof req.body.name !== 'undefined'&&req.body.name!=="")
                    dataFileVersion.name = req.body.name.replace(/ /g,"");
                  else if(req.body.name =="")
                    params=false;

                  if(typeof req.body.cid !== 'undefined'&&req.body.cid!=="")
                    dataFileVersion.cid = req.body.cid;
                  else if(req.body.cid =="")
                    params=false;

                  if(typeof req.body.uid !== 'undefined'&&req.body.uid!=="")
                    dataFileVersion.uid = req.body.uid;
                  else if(req.body.uid =="")
                    params=false;

                  dataFileVersion.udate = getFormattedDate();
                  if(params){
                    Api_file_versions.update({"id" : version_id},dataFileVersion,function(err,data){
                      if(err){
                        if(data.errcode==1)
                          res.json(data);
                        else
                          res.json(err);
                      }else{
                        Api_file_versions.findById({"id": version_id}, function(err,dataUpdate){
                          showFileVersion(dataUpdate,function(dataFileVersion){
                            res.json({"err_code": 0, "data" : dataFileVersion});
                          });
                        });
                      }
                    });
                  }else{
                    res.json({"err_code" : 3, "status" : "Parameters cannot Empty"});
                  }
                }else{
                  res.json({"err_code": 3, "err_msg": "Access denied"});
                }
              }else if(result2.err_code==1){
                res.json({"err_code": 2, "err_msg": "File Version ID is not found"});
              }else{
                res.json({"err_code": 3, "err_msg": "Access denied"});
              }
            });
          }else{
            res.json({"err_code": 2, "err_msg": "File Version ID must be numeric"});
          }
        }else{
          result.err_code = 500;
          res.json(result);
        }
      });
    }else{
      res.json({"err_code": 500, "err_msg": "Body cannot Empty"});
    }
  },
  delete : function deleteFileVersion(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;
        
    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;          
    }

    checkApikey(apikey, ipAddres, function(result){
      if(result.err_code == 0){
        //proses query ambil data file version
        var version_id = req.params.version_id;
        if(typeof version_id !== 'undefined'){
          if(id.test(version_id)){
            //check akses delete
            if(result.status=="root"||result.status=="active"){
              //hapus file version
              Api_file_versions.delete([{"id" : version_id}], function(err1,dataFileVersion){
                if(dataFileVersion.errcode==1){
                  res.json({"err_code": 2, "err_msg": "File Version ID is not found"});
                }else{
                  //tampilkan semua data setelah selesai hapus
                  Api_file_versions.find({}, function(err,data){
                    if(err){
                      if(data.errcode==1)
                        res.json(data);
                      else
                       res.json(err);
                    }else{
                      //cek jumdata dulu
                      if(data.length > 0){
                        //menampilkan data file version
                        showFileVersion(data,function(dataFileVersion){
                          res.json({"err_code": 0, "data":dataFileVersion});
                        });
                      }else{
                        res.json({"err_code": 4, "err_msg": "File data is empty", "application": "Api Document Management", "function": "deleteFileVersion"});
                      }
                    }
                  });
                }
              });
            }else{
              res.json({"err_code": 3, "err_msg": "Access denied for this file version"});
            }
          }else{
            res.json({"err_code": 2, "err_msg": "File Version ID must be numeric"});
          }
        }else{
          res.json({"err_code": 1, "err_msg": "File Version ID is required"});
        }
      }else{
        result.err_code = 500;
        res.json(result);
      }
    });
  }
}

var Download = {
  get    : function getDownload(req, res){
    var ipAddres = req.connection.remoteAddress;
    var apikey = req.params.apikey;
    var ipAddresHeader = req.headers.api;

    //check ip dengan header
    if (typeof ipAddresHeader !== 'undefined') {
      ipAddres = ipAddresHeader;  
      console.log("with Header");
      console.log(ipAddres);
    }

    console.log("without Header");
    console.log(ipAddres);   
    checkApikey(apikey, ipAddres, function(result){    
      console.log(ipAddres);                
      console.log(apikey);
      if(result.err_code==0){
        var file_id = req.params.file_id;
        if(typeof file_id !== 'undefined'){
          if(id.test(file_id)){
            //hanya boleh admin
            if(result.status=="root"){
              checkFile(file_id,function(result1){
                if(result1.err_code==0){
                  var idfile = result1.data[0].id;
                  var filename = result1.data[0].name;
                  var extension = path.extname(filename);
                  var filepath = result1.data[0].cdate;
                  var newfile = idfile+extension;
                  var str = filepath.substr(0, 10);
                  var todownload = __dirname + '/upload/' + str + '/' + newfile;
                  res.setHeader('Content-disposition', 'attachment; filename=' + newfile);
                  //res.setHeader('Content-Type', 'text/javascript');
                  //res.writeHead(200, {'Content-Type': 'text/event-stream'});
                  res.download(todownload);
                }else{
                  res.json(result1.status);
                }
              });
            }else{
              res.json({"err_code" : 3, "err_msg": "Access denied"});
            }
          }else{
            res.json({"err_code" : 2, "err_msg": "File ID must be numeric"});
          }
        }else{
          res.json({"err_code" : 1, "err_msg": "Not empty"});
        }
      }else{
        result.err_code = 500;
        res.json(result);
      }
    });
  }
}

//cek preview id ada atau tidak
function checkFilePreview(preview_id,callback){
    Api_file_previews.findById({"id" : preview_id},function(err,data){
        if(err){
          x(err);
        }else{
          if(data.length>0){
            x({"err_code": 0, "status": "File Preview is Exist", "data" : data});
          }else{
            x({"err_code": 1, "status": "File Preview ID is not found"});
          }
        }
    });

    function x(result){
      callback(result)
    }
}
//mengambil file preview id terakhir
function getFilePreviewId(apikey, callback){
  Api_file_previews.findLastId('id',function(err,data){
    if(err){
      x(err);
    }else{
      if(data.length > 0){
        var id = parseInt(data[0].id) + 1;
        x({"err_code": 0, "preview_id": id});
      }else{
        x({"err_code": 0, "preview_id": 1});
      }
    }
  });

  function x(result){
    callback(result)
  }
}
//tampilkan file previews
function showFilePreview(data,callback){
  var dataFile = [];
   for(key in data){
      
      if(data[key].ladate!==null)
        data[key].ladate = data[key].ladate;
      else
        data[key].ladate="null";

      dataFile[key] = {
        "id" : data[key].id,
        "content_id" : data[key].content_id,
        "group" : data[key].group,
        "status" : data[key].status,
        "filename" : data[key].filename,
        "size" : data[key].size,
        "cdate" : data[key].cdate,
        "ladate" : data[key].ladate
    };
  } callback(dataFile)
}


//cek id konten nama file di table file ada atau tidak
function checkFileContentIdAndName(content_id,filename, callback){
    Api_file.findWhereAnd([{content_id: content_id}, {name: filename}], function(err,data){
        if(err){
          x(err);
        }else{
          if(data.length>0){
            x({"err_code": 0, "status": "File is Exist", "data" : data});
          }else{
            x({"err_code": 1, "status": "File is not found"});
          }
        }
    });

    function x(result){
      callback(result)
    }
}
//cek id konten di table version ada atau tidak
function checkVersionContentId(content_id,callback){
    Api_file_versions.findWhere({"content_id" : content_id},function(err,data){
        if(err){
          x(err);
        }else{
          if(data.length>0){
            x({"err_code": 0, "status": "ID Content is Exist", "data" : data});
          }else{
            x({"err_code": 1, "status": "ID Content is not found"});
          }
        }
    });

    function x(result){
      callback(result)
    }
}
//cek id konten di table file ada atau tidak
function checkFileContentId(content_id,callback){
    Api_file.findWhere({"content_id" : content_id},function(err,data){
        if(err){
          x(err);
        }else{
          if(data.length>0){
            x({"err_code": 0, "status": "ID Content is Exist", "data" : data});
          }else{
            x({"err_code": 1, "status": "ID Content is not found"});
          }
        }
    });

    function x(result){
      callback(result)
    }
}
//cek konten md5 di table content ada atau tidak
function checkFileContentMd5(content_md5,callback){
    Api_file_content.findWhere({"md5" : content_md5},function(err,data){
        if(err){
          x(err);
        }else{
          if(data.length>0){
            x({"err_code": 0, "status": "File Content MD5 is Exist", "data" : data});
          }else{
            x({"err_code": 1, "status": "File Content MD5 is not found"});
          }
        }
    });

    function x(result){
      callback(result)
    }
}
//encrpyt content file md5 checksum
function generateFileChecksum(file){
  var result = fs.readFileSync(file);
  return md5(result);
}
//mengambil file content id terakhir
function getFileContentId(apikey, callback){
  Api_file_content.findLastId('id',function(err,data){
    if(err){
      x(err);
    }else{
      if(data.length > 0){
        var id = parseInt(data[0].id) + 1;
        x({"err_code": 0, "content_id": id});
      }else{
        x({"err_code": 0, "content_id": 1});
      }
    }
  });

  function x(result){
    callback(result)
  }
}
//tampilkan file content
function showFileContent(data,callback){
  var dataFile = [];
   for(key in data){
      
      if(data[key].pages!==null)
        data[key].pages = data[key].pages;
      else
        data[key].pages="null";

      dataFile[key] = {
        "id" : data[key].id,
        "size" : data[key].size,
        "pages" : data[key].pages,
        "type" : data[key].type,
        "path" : data[key].path,
        "ref_count" : data[key].ref_count,
        "parse_status" : data[key].parse_status,
        "skip_parsing" : data[key].skip_parsing,
        "md5" : data[key].md5
    };
  } callback(dataFile)
}

//cek id file version ada atau tidak
function checkFileVersion(version_id,callback){
    Api_file_versions.findById({"id" : version_id},function(err,data){
        if(err){
          x(err);
        }else{
          if(data.length>0){
            x({"err_code": 0, "status": "File version is Exist", "data" : data});
          }else{
            x({"err_code": 1, "status": "File Version ID is not found"});
          }
        }
    });

    function x(result){
      callback(result)
    }
}
//mengambil file version id terakhir
function getFileVersionId(apikey, callback){
  Api_file_versions.findLastId('id',function(err,data){
    if(err){
      x(err);
    }else{
      if(data.length > 0){
        var id = parseInt(data[0].id) + 1;
        x({"err_code": 0, "version_id": id});
      }else{
        x({"err_code": 0, "version_id": 1});
      }
    }
  });

  function x(result){
    callback(result)
  }
}
//cek file version user ada atau tidak
function checkFileVersionUser(user_id,callback){
    Api_file_versions.findById({"uid" : user_id},function(err,data){
        if(err){
          x(err);
        }else{
          if(data.length>0){
            x({"err_code": 0, "status": "File Version User is Exist", "data" : data});
          }else{
            x({"err_code": 1, "status": "File Version User is not found"});
          }
        }
    });

    function x(result){
      callback(result)
    }
}

//tampilkan file version
function showFileVersion(data,callback){
  var dataFile = [];
   for(key in data){
      data[key].cdate = data[key].cdate.slice(0,19).replace('T',' ');

      if(data[key].udate!==null)
        data[key].udate = data[key].udate.slice(0,19).replace('T',' ');
      else
        data[key].udate="null";

      if(data[key].date!==null)
        data[key].date = data[key].date.slice(0,19).replace('T',' ');
      else
        data[key].date="null";

      dataFile[key] = {
        "id" : data[key].id,
        "file_id" : data[key].file_id,
        "content_id" : data[key].content_id,
        "date" : data[key].date,
        "name" : data[key].name,
        "cid" : data[key].cid,
        "uid" : data[key].uid,
        "cdate" : data[key].cdate,
        "udate" : data[key].udate
    };
  } callback(dataFile)
}
//mengambil file id terakhir
function getFileId(apikey, callback){
  Api_file.findLastId('id',function(err,data){
    if(err){
      x(err);
    }else{
      if(data.length > 0){
        var id = parseInt(data[0].id) + 1;
        x({"err_code": 0, "file_id": id});
      }else{
        x({"err_code": 0, "file_id": 1});
      }
    }
  });

  function x(result){
    callback(result)
  }
}
//cek konten id ada atau tidak
function checkFileContent(content_id,callback){
    Api_file_content.findById({"id" : content_id},function(err,data){
        if(err){
          x(err);
        }else{
          if(data.length>0){
            x({"err_code": 0, "status": "File Content is Exist", "data" : data});
          }else{
            x({"err_code": 1, "status": "File Content ID is not found"});
          }
        }
    });

    function x(result){
      callback(result)
    }
}
//tampilkan file
function showFile(data,callback){
  var dataFile = [];
   for(key in data){
      data[key].cdate = data[key].cdate.slice(0,19).replace('T',' ');

      if(data[key].udate!==null)
        data[key].udate = data[key].udate.slice(0,19).replace('T',' ');
      else
        data[key].udate="null";

      if(data[key].date!==null)
        data[key].date = data[key].date.slice(0,19).replace('T',' ');
      else
        data[key].date="null";

      dataFile[key] = {
        "id" : data[key].id,
        "content_id" : data[key].content_id,
        "date" : data[key].date,
        "name" : data[key].name,
        "title" : data[key].title,
        "cid" : data[key].cid,
        "uid" : data[key].uid,
        "cdate" : data[key].cdate,
        "udate" : data[key].udate
    };
  } callback(dataFile)
}
//cek id file ada atau tidak
function checkFile(file_id,callback){
    Api_file.findById({"id" : file_id},function(err,data){
        if(err){
          x(err);
        }else{
          if(data.length>0){
            x({"err_code": 0, "status": "File is Exist", "data" : data});
          }else{
            x({"err_code": 1, "status": "File ID is not found"});
          }
        }
    });

    function x(result){
      callback(result)
    }
}
//cek file user ada atau tidak
function checkFileUser(user_id,callback){
    Api_file.findById({"uid" : user_id},function(err,data){
        if(err){
          x(err);
        }else{
          if(data.length>0){
            x({"err_code": 0, "status": "File User is Exist", "data" : data});
          }else{
            x({"err_code": 1, "status": "File User is not found"});
          }
        }
    });

    function x(result){
      callback(result)
    }
}
//cek apikey ada atau tidak
function checkApikey(apikey, ipAddres, callback){
  Api_user.findWhere({"user_apikey" : apikey}, function(err, data){
    if(err){
      x(err);
    }else{
      if(data.length>0){
        //check user_role_id == 1 <-- admin/root
        if(data[0].user_role_id==1){
          x({"err_code": 0, "status": "root", "data" : data});
        }else{
          if(apikey==data[0].user_apikey){
              dataIpAddress = data[0].user_ip_address;
              if(dataIpAddress.indexOf(ipAddres)>=0){
                  if(data[0].user_is_active){
                      x({"err_code": 0, "status": "active", "data" : data});
                  }else{
                      x({"err_code": 5, "err_msg": "User is not active"});
                  }
              }else{
                x({"err_code": 4, "err_msg": "IP Address is not registered"});
              }
          }else{
            x({"err_code": 3, "err_msg": "Wrong apikey"});
          }
        }
      }else{
        x({"err_code": 3, "err_msg": "Wrong apikey"});
      }
    }
  });

  function x(result){
    callback(result)
  }
}
//check user ada atau tidak
function checkUser(user_id,callback){
    Api_user.findById({"user_id" : user_id},function(err,data){
        if(err){
          x(err);
        }else{
          if(data.length>0){
            x({"err_code": 0, "status": "User is Exist", "data" : data});
          }else{
            x({"err_code": 1, "status": "User ID is not found"});
          }
        }
    });

    function x(result){
      callback(result)
    }
}
//format date
function getFormattedDate() {
  var date = new Date();
  var str = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " +  date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();

  return str;
}
//make new folder use date
function getPath() {
  var date = new Date();
  var str = date.format('yyyy-mm-dd');

  return str;
}


// for download
app.get('/:apikey/download/:file_id?', Download.get);


//get method
app.get('/:apikey/file/:file_id?', File.get);
app.get('/:apikey/content/:content_id?', Content.get);
app.get('/:apikey/preview/:preview_id?', Preview.get);
app.get('/:apikey/version/:version_id?', Version.get);

//post method
app.post('/:apikey/file', File.post);
app.post('/:apikey/content', Content.post);
app.post('/:apikey/preview', Preview.post);
app.post('/:apikey/version', Version.post);


//put method
app.put('/:apikey/file/:file_id?', File.put);
app.put('/:apikey/content/:content_id?', Content.put);
app.put('/:apikey/preview/:preview_id?', Preview.put);
app.put('/:apikey/version/:version_id?', Version.put);

//delete method
app.delete('/:apikey/file/:file_id?', File.delete);
app.delete('/:apikey/content/:content_id?', Content.delete);
app.delete('/:apikey/preview/:preview_id?', Preview.delete);
app.delete('/:apikey/version/:version_id?', Version.delete);

var server = app.listen(port, host, function () {
  console.log("Server running at http://%s:%s", host, port);
});