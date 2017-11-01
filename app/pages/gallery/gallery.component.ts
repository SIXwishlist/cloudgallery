import { Page } from "ui/page";
import { Component, OnInit } from "@angular/core";
import { Util } from "../../common/util";
import Loader from "../../common/loader";
import { GalleryItem } from "../../common/gallery.item";
import GalleryCache from "../../common/gallery.cache";
import * as Toast from 'nativescript-toast';
import { TNSFontIconService } from 'nativescript-ngx-fonticon';
import { ObservableArray } from "tns-core-modules/data/observable-array";
import * as ImageSourceModule from "image-source";
import * as Http from "tns-core-modules/http"
import { RadListView, ListViewStaggeredLayout } from "nativescript-telerik-ui-pro/listview"
import * as timer from "timer";
import * as Settings from "application-settings";
import * as Platform from "platform";
import { TranslateService } from "ng2-translate";
import { on as applicationOn, off as applicationOff, launchEvent, suspendEvent, resumeEvent, exitEvent, lowMemoryEvent, uncaughtErrorEvent, ApplicationEventData, start as applicationStart } from "application";
import * as utf8 from "utf8"; 
import * as  Base64 from "base-64";
import * as application from "application";
import { AndroidApplication, AndroidActivityBackPressedEventData } from "application";
import { confirm } from "ui/dialogs";
import * as appversion from "nativescript-appversion"; 
import * as email from "nativescript-email";
import {screen} from "tns-core-modules/platform/platform"

import * as elementRegistryModule from 'nativescript-angular/element-registry';
elementRegistryModule.registerElement("CardView", () => require("nativescript-cardview").CardView);

  
@Component({
  selector: "gallery",
  templateUrl: "pages/gallery/gallery.html",
  styleUrls: ["pages/gallery/gallery.css"],
  providers: [Util]
})
 

export class GalleryComponent {

    private language;
    private version;

    private host;
    private username;
    private password;
    private rootdir;
    private headers;

    private radList: RadListView;
    private orientation;
    private nColMin;
    private nColMax;

    /*
    private images = new ObservableArray<ObservableArray<GalleryItem>>();
    private current = new ObservableArray<GalleryItem>();
    private history = new Array();
    */

    //private nodeid;
    //private path;
    //private title;

    private current = new ObservableArray<GalleryItem>();
    private progressNum = 0;
    private progressTot = 0;
    private progressVal = 0;
    private footer = "";
    private imageScanner;

    public constructor(
      private page: Page,
	    private util: Util,
      private fonticon: TNSFontIconService,
      private translate: TranslateService,
      private cache: GalleryCache,
      private loader: Loader    
    )  {

      //calc dimensions for responsive view
      let nCol1 = Math.floor(screen.mainScreen.heightDIPs/320)*3;
      let nCol2 = Math.floor(screen.mainScreen.widthDIPs/320)*3;
      if(nCol1>nCol2) { this.nColMax=nCol1; this.nColMin=nCol2}
      else { this.nColMax=nCol2; this.nColMin=nCol1}
      
      this.util.log("Responsive columns: ", this.nColMax + " or " + this.nColMin);
              
      appversion.getVersionName().then((v: string)=> {
          this.version = "Version " + v;
      });

      this.language = Platform.device.language;
      this.translate.setDefaultLang("en");
      this.translate.use(Platform.device.language.split("-")[0]).subscribe(()=> {
        this.host = Settings.getString("host");
        this.username = Settings.getString("username");
        this.password = Settings.getString("password");
        this.rootdir = Settings.getString("rootdir");  
        this.rootdir = (this.rootdir==null)? "":this.rootdir;
        this.headers = { 
          "OCS-APIREQUEST": "true",
          "Authorization": "Basic "+Base64.encode(this.username+':'+this.password)
        }    

        this.cache.items = new Array<GalleryItem>();
        this.home();
      });
    }

    onRadListLoaded(args) {
      this.radList = <RadListView>args.object;  
      this.util.log("View Size: " + this.radList.getMeasuredWidth() + "x" + this.radList.getMeasuredHeight(), null);

      this.util.log("Initial screen orientation: ", screen.mainScreen.widthDIPs + "x" + screen.mainScreen.heightDIPs);
      if(screen.mainScreen.widthDIPs>screen.mainScreen.heightDIPs) {
        this.orientation = "landscape";
      } else {
        this.orientation = "portrait";
      }  
      this.updateView();   
    }

    ngOnInit() {
      this.page.actionBarHidden = false;
      this.util.log("Page Init Gallery", null); 
      this.updateView();      

      if (application.android) {
        application.android.on(
            AndroidApplication.activityBackPressedEvent, 
            (data: AndroidActivityBackPressedEventData) => {
                data.cancel = true; // prevents default back button behavior
                this.back();
            } 
        );       
      }

      /*
      applicationOn(resumeEvent, (args: ApplicationEventData)=> {
          this.loadGallery({path: this.path, nodeid: this.nodeid});
      });   
      */ 

      applicationOn("orientationChanged", (e)=>{ 
        this.orientation = e.newValue;
        this.updateView(); 
      });   
    }

    ngOnDestroy() {
      applicationOff("orientationChanged", this.updateView);
    }    
 
    updateView() {
      try {
        this.util.log("Update view on orientation: ", this.orientation);
        if(this.orientation == "portrait") {
            let staggeredLayout = new ListViewStaggeredLayout();
            staggeredLayout.spanCount = this.nColMin;
            staggeredLayout.scrollDirection = "Vertical";
            this.radList.listViewLayout = staggeredLayout;
        } else {
            let staggeredLayout = new ListViewStaggeredLayout();
            staggeredLayout.spanCount = this.nColMax;
            staggeredLayout.scrollDirection = "Vertical";
            this.radList.listViewLayout = staggeredLayout;
        }      
      } catch(e) {
        this.util.log("Error update view", e);
      }      
    }

    private clearCurrent() {
      while(this.current.length>0) {
        this.current.pop();   
      }
    }  

    private home() {
      this.util.log("home", null);
      this.cache.history = new Array();
      this.cache.currentAlbum.path = this.rootdir; 
      this.cache.currentAlbum.nodeid = "/";
      this.loadGallery({
        path: this.cache.currentAlbum.path, 
        nodeid: this.cache.currentAlbum.nodeid
      });
    }

    private back() {
      if(this.util.getCurrentRoute()!="/imager") {
        if(this.cache.history.length>1) {
          let current = this.cache.history.pop();
          let back = this.cache.history.pop();
          this.loadGallery(back); 
        } else {
          let options = {
              title: this.translate.instant("Exit?"),
              message: this.translate.instant("Are you sure you want to exit?"),
              okButtonText: this.translate.instant("Yes"),
              cancelButtonText: this.translate.instant("No")
          };

          this.util.log("Back confirm exit?", null); 
          confirm(options).then((result: boolean) => {
              this.util.log("Back", result);          
              if(result) {
                this.util.exit();
              }
          });        
        }
      }
    }

    private exit() {
      Settings.setString("host", "");
      Settings.setString("username", "");
      Settings.setString("password", "");
      Settings.setString("rootdir", "");        
      this.util.navigate("settings");
    }
 
    private loadGallery(item) {
       
      this.loader.showLoader(this.translate.instant("Loading albums…"));
      this.util.log("Load Gallery", item); 
      //this.util.log("Load Gallery", null); 

      let path = item.path;
      let nodeid = item.nodeid;

      if(this.cache.items[nodeid]==null) {
        this.cache.items[nodeid] = new GalleryItem();
      }

      this.clearCurrent();

      this.footer = "";

      this.cache.currentAlbum.nodeid = nodeid;
      this.cache.currentAlbum.path = path;
      let path_chunk = path.split("/");
      this.cache.currentAlbum.title = path_chunk[path_chunk.length-1];
      this.cache.currentAlbum.title = (this.cache.currentAlbum.title=="")? this.host.split("//")[1] : this.cache.currentAlbum.title;

      this.progressNum = 0;
      this.progressVal = 0;

      // string sanitize
      let pathsan = this.util.replaceAll(path, "&", "%26"); 
      pathsan = this.util.replaceAll(pathsan, " ", "%20");       
      let url = this.host+"/index.php/apps/gallery/api/files/list?location="+pathsan+"&mediatypes=image/jpeg;image/gif;image/png;image/x-xbitmap;image/bmp&features=&etag";

      this.util.log("GET list", null);

      // try from cache first
      //this.util.log("Get Album Cache", this.cache.images[this.cache.currentAlbum.nodeid]);
      this.util.log("Get Album Cache: " + this.cache.currentAlbum.nodeid, null);
      if(this.cache.items[this.cache.currentAlbum.nodeid].isAlbum
        && this.cache.items[this.cache.currentAlbum.nodeid].loaded) {
        
        this.util.log("Cache Found! Retrieving from cache", null);
        for(let a in this.cache.items[this.cache.currentAlbum.nodeid].items) {
          let item = this.cache.items[this.cache.currentAlbum.nodeid].items[a];
          if(item.isAlbum) {
            //this.util.log("Cache album added", item); 
            this.util.log("Cache album added: " + a, null);
            this.current.push(item);
          }
        }

        // reverse order
        let cacheImagesIndex = [];
        for(let a in this.cache.items[this.cache.currentAlbum.nodeid].items) {
          cacheImagesIndex.push(a);
        }
        cacheImagesIndex.reverse()
        for(let b in cacheImagesIndex) {
          let item = this.cache.items[this.cache.currentAlbum.nodeid].items[cacheImagesIndex[b]];
          if(!item.isAlbum) {
            //this.util.log("Cache image added", item); 
            this.util.log("Cache image added: " + b, null);
            this.current.push(item);
            this.progressNum++;
          }
        }         
        this.updateFooter(this.cache.items[this.cache.currentAlbum.nodeid].totAlbums, this.cache.items[this.cache.currentAlbum.nodeid].totImages);
        let data = this.cache.items[this.cache.currentAlbum.nodeid].data;

        // otherwise too fast :)
        timer.setTimeout(()=> { 
          this.loader.hideLoader(); 
          this.scanImages(data.files, nodeid);
        }, 800); 

        this.progressVal = 100;
 
      } else {

        this.util.log("Cache Not Found :( Retrieving from cloud…", null);
      
        Http.request({
            url: url,
            method: "GET",
            headers: this.headers
        }).then((response:any)=> {
            let data = null;

            try {
              data = response.content.toJSON();
            } catch(e) {
              Toast.makeText(this.translate.instant("Error loading. Please retry")).show();
              this.util.log("Error loading data", e);
              this.loader.hideLoader();
              return;              
            }

            if(data==null) {
              Toast.makeText(this.translate.instant("Error loading. Please retry")).show();
              this.util.log("Error Data null", null);
              this.loader.hideLoader();
              return;   
            }

            //this.util.log("response to ", path+"("+nodeid+"), current album:" + this.cache.currentAlbum.nodeid);
            this.util.log("Response to ("+nodeid+"), Current album:" + this.cache.currentAlbum.nodeid, null);

            let albums = data.albums;  
            // error loading
            if(albums==null) {
              Toast.makeText(this.translate.instant("Error loading. Please exit and reconfigure")).show();
              this.loader.hideLoader();
              return;
            }

            let totAlbums = 0;
            this.progressTot = albums.length;
            this.progressNum = 0;
            for(let j in albums) {
              if(albums[j].size!=0) {
                let albumObj = new GalleryItem();
                albumObj.path = albums[j].path;
                let path_chunk = albumObj.path.split("/");
                let current_chunk = this.cache.currentAlbum.path.split("/");
                albumObj.title = path_chunk[path_chunk.length-1];
                albumObj.isAlbum = true;
                albumObj.src = "";
                albumObj.nodeid = albums[j].nodeid;
                albumObj.items = new Array<GalleryItem>();

                if(albumObj.path==data.albumpath) {
                  // excludes current album
                } else if(path_chunk.length>current_chunk.length+1) {
                  // excludes more levels albums
                } else {
                  this.current.push(albumObj);
                  if(this.cache.items[this.cache.currentAlbum.nodeid].items==null) {
                    this.cache.items[this.cache.currentAlbum.nodeid].items = new Array<GalleryItem>();
                  }
                  this.cache.items[this.cache.currentAlbum.nodeid].items.push(albumObj);
                  totAlbums++;
                  //this.util.log("Album added to "+nodeid+":", albumObj);
                  this.util.log("Album added to "+nodeid, null);
                }
              }
              this.progressNum++;
              this.progressVal = (this.progressNum*100)/this.progressTot;
            } 
            this.progressVal = 100;
            this.cache.items[this.cache.currentAlbum.nodeid].isAlbum = true;
            this.cache.items[this.cache.currentAlbum.nodeid].loaded = true;
            this.cache.items[this.cache.currentAlbum.nodeid].totAlbums = totAlbums;
            this.cache.items[this.cache.currentAlbum.nodeid].data = data;
            this.cache.currentAlbum.totAlbums = totAlbums;
            //this.util.log("Set Album Cache", this.cache.images[this.cache.currentAlbum.nodeid]);
            this.util.log("Set Album Cache: " + this.cache.currentAlbum.nodeid, null);

            this.updateFooter(totAlbums, 0);
            this.updateView(); 
            this.scanImages(data.files, nodeid);

          }, (e)=> {
              Toast.makeText(this.translate.instant("Error loading. Please retry")).show();
              this.util.log("Error Http", e);
              console.log(e);
              this.loader.hideLoader();
              return;
          }); 
      }

      let historyItem = new GalleryItem();
      historyItem.isAlbum = true;
      historyItem.path = this.cache.currentAlbum.path;
      historyItem.nodeid = this.cache.currentAlbum.nodeid;
      this.cache.history.push(historyItem); 
    }

    private scanImages(files, nodeid) {
      try {
        // checks for available images
        let toShowLoader = false;
        let totFiles = 0;
        let totAlbums = this.cache.items[nodeid].totAlbums;

        this.cache.currentAlbum.items = new Array<GalleryItem>();

        for(let i in files) {
          let lastIndex = files.length-1-(+i);

          let filepath = "";
          let filepath_chunk = files[lastIndex].path.split("/");

          for(let c=0; c<filepath_chunk.length-1; c++) {
            filepath += filepath_chunk[c] + "/"
          }

          if(filepath==this.cache.currentAlbum.path+"/") {
            totFiles++;

            if(this.cache.items[nodeid]==null ||
              this.cache.items[nodeid].items==null ||
              this.cache.items[nodeid].items[files[lastIndex].nodeid]==null ||
              !this.cache.items[nodeid].items[files[lastIndex].nodeid].loaded) { 
              
              toShowLoader = true;

            } else {
              let imgObj = this.cache.items[nodeid].items[files[lastIndex].nodeid];
              this.cache.currentAlbum.items.push(imgObj); 
            }
          }
        }

        this.cache.items[nodeid].totImages = totFiles;
        this.cache.currentAlbum.totImages = totFiles;
        
        if(toShowLoader) {
          this.loader.showLoader(this.translate.instant("Loading images…"));          
          //this.progressNum = 0;
          this.progressTot = totFiles;
          this.progressVal = 0;

          this.updateFooter(totAlbums, totFiles);

        } else {
          this.loader.hideLoader();
        }
        
        for(let i in files) { 
          let lastIndex = files.length-1-(+i);

          if(this.cache.items[nodeid]==null ||
            this.cache.items[nodeid].items==null ||
            this.cache.items[nodeid].items[files[lastIndex].nodeid]==null ||
            !this.cache.items[nodeid].items[files[lastIndex].nodeid].loaded) { 

            this.imageScanner = timer.setTimeout(
              ()=> { this.loadImages(nodeid, files[lastIndex]) }, 
              200*(+i));
          }
        }  

      } catch(e) {
        this.util.log("Error scan images", e);
        Toast.makeText(this.translate.instant("Error loading. Please retry")).show();
      }     
    }

    private loadImages(albumid, item) {
      if(albumid==this.cache.currentAlbum.nodeid) { 
        let filepath = "";
        let filepath_chunk = item.path.split("/");
        for(let c=0; c<filepath_chunk.length-1; c++) {
          filepath += filepath_chunk[c] + "/"
        }
 
        if(filepath==this.cache.currentAlbum.path+"/") {
          let imgurlroot = this.host+"/index.php/apps/gallery/api/preview/" + item.nodeid;
        
          Http.request({
              url: imgurlroot + "/150/150",
              method: "GET",
              headers: this.headers
          }).then((response:any)=> {

            if(albumid==this.cache.currentAlbum.nodeid) { 
              let imgObj = new GalleryItem();
              response.content.toImage()
                .then((image)=> {
                  let base64 = image.toBase64String();
                  imgObj.src = base64;
                  imgObj.title = filepath_chunk[filepath_chunk.length-1];
                  imgObj.url = imgurlroot;
                  imgObj.mtime = item.mtime;
                  imgObj.loaded = true;

                  this.current.push(imgObj);
                  
                  if(this.cache.currentAlbum.items==null) {
                    this.cache.currentAlbum.items = new Array<GalleryItem>();
                  }
                  this.cache.currentAlbum.items.push(imgObj);                  

                  if(this.cache.items[this.cache.currentAlbum.nodeid].items==null) {
                    this.cache.items[this.cache.currentAlbum.nodeid].items = new Array<GalleryItem>();
                  }
                  this.cache.items[this.cache.currentAlbum.nodeid].items[item.nodeid] = imgObj;
                  this.progressNum++;
                  this.progressVal = (this.progressNum*100)/this.progressTot;
                  //this.util.log("file added to "+albumid+": ", "(" + item.nodeid + ") " + item.path + " - " + item.mtime);
                  this.util.log("File added to "+albumid+" (" + item.nodeid + ") - " + item.mtime, null);
                })
                .catch((error)=> {
                  this.util.log("Error toImage", error);
                });  

				      // hide the loader when first image in directory is loaded
              this.loader.hideLoader();
            }

          }, (e)=> {
              Toast.makeText(this.translate.instant("Error loading. Please retry")).show();
          });      
        }
      } else {
        timer.clearTimeout(this.imageScanner);
      }
    }

    private updateFooter(numAlbums, numFiles) {
      let footerAlbum = (numAlbums>0)? numAlbums + " " + this.translate.instant("Collections") : "";
      let footerFiles = (numFiles>0)? numFiles + " " + this.translate.instant("Files") : "";
      this.footer = "";
      this.footer += footerAlbum;
      this.footer += (numAlbums>0 && numFiles>0)? " / " : "";
      this.footer += footerFiles;
      this.util.log("updateFooter", this.footer);
    }

    onTapFolder(item) {
      //this.util.log("tap", item);
      this.util.log("Tap item folder", null);
      this.loadGallery(item);
    }

    onTapImage(item) {
      //this.util.log("tap", item.title);
      this.util.log("Tap item image", null);
      this.cache.currentImage = item;
      this.loader.showLoader(this.translate.instant("Loading image…")); 
      this.util.navigate("imager");
    } 

    sendLog() {
      if(this.util.DEBUG && this.util.LOGTOSETTINGS) {
        email.compose({
          subject: "Cloud Gallery Log",
          body: Settings.getString("_LOG"),
          to: ['info@linfaservice.it']
        });
      }
    }
   

}
